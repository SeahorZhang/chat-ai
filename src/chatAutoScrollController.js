/**
 * 聊天列表自动滚动控制器
 *
 * 设计目标：
 * 1. 用户位于底部附近时，新消息到来后自动跟随到底部。
 * 2. 用户一旦主动滚动，就立刻让出控制权，避免打断阅读。
 * 3. “回到底部”按钮只在真正离底部较远、且滚动已停稳后显示。
 *
 * 实现原则：
 * - 单一职责：控制器只关心滚动状态，不关心消息内容。
 * - 显式状态：所有行为都只围绕 `autoScrollEnabled`、`isUserInteracting`、
 *   `showBackToBottom` 这几个状态展开，避免隐式副作用。
 * - 帧级合并：scroll / 新消息事件都尽量合并到 requestAnimationFrame，
 *   减少高频事件导致的重复计算与重复渲染。
 * - 持续追底：平滑滚动不用浏览器原生 smooth，而是每帧读取最新底部，
 *   这样在流式输出、内容换行、节点重排时也能持续贴住最新底部。
 */
export function createChatAutoScrollController({
  state,
  bottomThreshold = 24,
  showButtonOffset = 160,
  touchReleaseDelay = 280,
  scrollIdleDelay = 180,
}) {
  // rAF / timer 句柄。所有异步句柄都集中管理，销毁时可一次性清理。
  let scrollRafId = null
  let followRafId = null
  let smoothScrollRafId = null
  let touchReleaseTimer = null
  let scrollIdleTimer = null

  // =====================
  // 位置计算与状态同步
  // =====================

  /** 当前距离底部还有多少像素 */
  function getDistanceToBottom(scrollEl) {
    if (!scrollEl) return 0
    return Math.max(scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight, 0)
  }

  /** 滚动容器能够滚到的最后一个 scrollTop */
  function getBottomTop(scrollEl) {
    if (!scrollEl) return 0
    return Math.max(scrollEl.scrollHeight - scrollEl.clientHeight, 0)
  }

  /** 是否仍处在“可以安全自动跟随”的区域 */
  function isNearBottom(scrollEl) {
    return getDistanceToBottom(scrollEl) <= bottomThreshold
  }

  /** 当前是否正处于用户手动交互阶段 */
  function isUserInteractionActive() {
    return state.isUserInteracting
  }

  /**
   * 按当前位置同步外部状态。
   *
   * 这里拆成两个维度：
   * - `autoScrollEnabled`：决定新消息是否继续自动跟随
   * - `showBackToBottom`：决定按钮是否显示
   *
   * 按钮显隐的规则更严格：
   * - 只在“不滑动 / 已停稳”时更新
   * - 只由距离底部是否超过阈值决定
   */
  function updateByPosition(scrollEl, { allowButton = true } = {}) {
    const distance = getDistanceToBottom(scrollEl)

    state.autoScrollEnabled = distance <= bottomThreshold

    if (allowButton) {
      state.showBackToBottom = distance > showButtonOffset
    }
  }

  // =====================
  // 句柄清理与自动滚动终止
  // =====================

  /** 清理“触摸释放”计时器，避免旧回调在新的交互阶段误触发 */
  function clearTouchReleaseTimer() {
    if (!touchReleaseTimer) return
    clearTimeout(touchReleaseTimer)
    touchReleaseTimer = null
  }

  /** 清理“滚动停稳”计时器，确保只保留最后一次 idle 判定 */
  function clearScrollIdleTimer() {
    if (!scrollIdleTimer) return
    clearTimeout(scrollIdleTimer)
    scrollIdleTimer = null
  }

  /** 取消 scroll 事件的帧合并任务，防止销毁后仍写状态 */
  function cancelScrollRaf() {
    if (!scrollRafId) return
    cancelAnimationFrame(scrollRafId)
    scrollRafId = null
  }

  /** 取消“新消息追底”调度，避免重复启动滚动动画 */
  function cancelFollow() {
    if (!followRafId) return
    cancelAnimationFrame(followRafId)
    followRafId = null
  }

  /**
   * 取消平滑滚动动画。
   *
   * 这是“用户接管优先”原则的一部分：
   * 只要用户开始手动操作，任何尚未结束的自动滚动都必须立刻停止。
   */
  function cancelSmoothScroll() {
    if (!smoothScrollRafId) return
    cancelAnimationFrame(smoothScrollRafId)
    smoothScrollRafId = null
  }

  /**
   * 停止一切自动滚动行为，让控制权完全回到用户手里。
   *
   * 这里故意不清理 scroll/touch 的 timer：
   * - `cancelFollow` / `cancelSmoothScroll` 负责“动画”层面停止
   * - timer 仍保留给交互状态机自己处理
   * - 这样职责边界更清晰，也能避免误杀本该继续生效的 idle 判定
   */
  function stopAutoScroll() {
    cancelFollow()
    cancelSmoothScroll()
  }

  /**
   * 自动滚动开始前的统一准备动作。
   *
   * 在开始新的自动滚动前，先把旧的交互痕迹清掉：
   * - 清理 touch release / scroll idle timer，避免旧状态反向覆盖新状态
   * - 停止已有动画，避免两个自动滚动过程互相打架
   */
  function prepareAutoScroll() {
    clearTouchReleaseTimer()
    clearScrollIdleTimer()
    stopAutoScroll()
  }

  // =====================
  // 用户交互态管理
  // =====================

  /**
   * 进入“用户接管”后，不立刻恢复自动滚动，而是等待一段空闲时间。
   *
   * 原理：
   * - 移动端下，touchend / touchcancel 的触发并不总是稳定。
   * - 单纯依赖结束事件，容易出现“用户已经停下，但状态没释放”或
   *   “惯性滚动还没结束，自动滚动又抢回去了”这类问题。
   * - 因此这里采用“延迟释放”策略：
   *   1. touchstart / pointerdown / wheel 立刻上锁
   *   2. 后续每次 scroll 都刷新释放计时器
   *   3. 一段时间没有新的滚动，再自动解锁
   *
   * 这里要注意：
   * - “按钮是否显示”与新消息、流式渲染无关
   * - 它只和两件事有关：当前是否仍在滑动、以及离底部是否足够远
   * - 所以手动接管期间只负责隐藏按钮，并把最终显示时机交给 idle 阶段
   *
   * 这样能同时兼容：
   * - 鼠标滚轮
   * - 触摸拖动
   * - 惯性滚动
   * - 某些浏览器事件缺失的情况
   */
  function scheduleInteractionRelease(scrollEl) {
    clearTouchReleaseTimer()
    touchReleaseTimer = setTimeout(() => {
      touchReleaseTimer = null
      state.isUserInteracting = false

      // 触摸释放时，说明已经有一段时间没有新的 scroll 事件了。
      // 此时除了更新自动跟随资格，还要立刻按“停稳后的规则”重新判断按钮。
      // 否则 scroll idle 计时器更早触发并被交互态拦下后，按钮就不会再有
      // 下一次机会显示，表现为“明明离底部很远，但按钮一直不出现”。
      updateByPosition(scrollEl)
    }, touchReleaseDelay)
  }

  /**
   * 只有在滚动停稳之后，才最终决定是否显示“回到底部”按钮。
   *
   * 这样做的好处：
   * - scroll 过程中不频繁切换按钮显隐
   * - 用户滑动时界面更稳定
   * - reactive 更新更少，避免不必要渲染
   */
  function scheduleScrollIdle(scrollEl) {
    clearScrollIdleTimer()
    scrollIdleTimer = setTimeout(() => {
      scrollIdleTimer = null

      // 手指仍在接管时，不更新按钮显隐。
      // 否则在移动端惯性较弱或 scroll 事件间隔较大时，idle 计时器可能
      // 会抢先触发，导致“回到底部”按钮在手指滑动过程中短暂出现又消失。
      if (isUserInteractionActive()) {
        return
      }

      updateByPosition(scrollEl)
    }, scrollIdleDelay)
  }

  /**
   * 进入用户手动交互态。
   *
   * 这个状态表示：
   * - 用户正在主动浏览列表
   * - 自动滚动必须让出控制权
   * - “回到底部”按钮要等交互结束后再按距离规则决定是否显示
   */
  function activateUserInteraction(scrollEl) {
    stopAutoScroll()
    clearScrollIdleTimer()

    state.isUserInteracting = true
    state.autoScrollEnabled = false

    scheduleInteractionRelease(scrollEl)
  }

  /** 触摸开始：说明用户准备手动浏览消息列表 */
  function handleTouchStart(scrollEl) {
    // 触摸开始通常意味着用户准备手动浏览历史消息，立即切换到手动接管态。
    activateUserInteraction(scrollEl)
  }

  /** pointer down：统一覆盖鼠标、触控笔等非触摸输入 */
  function handlePointerDown(scrollEl) {
    // pointerdown 覆盖鼠标按下、触控笔等输入源，让不同设备行为一致。
    activateUserInteraction(scrollEl)
  }

  /** wheel：表示用户通过滚轮手动浏览列表 */
  function handleWheel(scrollEl) {
    // 滚轮滚动也是明确的手动意图，因此同样立刻暂停自动跟随。
    activateUserInteraction(scrollEl)
  }

  // =====================
  // 滚动事件处理
  // =====================

  /**
   * 处理滚动事件。
   *
   * 职责拆分：
   * 1. 进入滚动时立刻隐藏按钮。
   * 2. 用 idle timer 在滚动停止后再决定按钮显隐。
   * 3. 如果用户正在交互，则持续延长保护期。
   * 4. 用一帧合并多个 scroll 事件，只做一次位置同步。
   *
   * 关键约束：
   * - 按钮是否显示，只由“当前是否已经停稳”+“离底部距离”决定。
   * - 因此滚动过程中无论发生什么，都不允许把按钮重新显示出来。
   *
   * 性能点：
   * - 浏览器滚动事件非常高频，尤其在触控板和移动端上更明显。
   * - 这里通过 requestAnimationFrame 合并更新，避免每次 scroll 都触发
   *   一轮完整的状态计算与响应式更新。
   */
  function handleScroll(scrollEl) {
    if (!scrollEl) return

    if (state.showBackToBottom) {
      state.showBackToBottom = false
    }

    scheduleScrollIdle(scrollEl)

    if (isUserInteractionActive()) {
      scheduleInteractionRelease(scrollEl)
    }

    if (scrollRafId) return

    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = null
      updateByPosition(scrollEl, { allowButton: false })
    })
  }

  // =====================
  // 自动追底与位置纠正
  // =====================

  /**
   * 立即贴到底部；用于需要无动画纠正位置的场景。
   *
   * 适合：
   * - 首屏初始化
   * - 动画结束后的最终纠偏
   * - 需要确保位置绝对准确的场景
   */
  function jumpToBottom(scrollEl) {
    if (!scrollEl) return
    scrollEl.scrollTop = getBottomTop(scrollEl)
    updateByPosition(scrollEl)
  }

  /**
   * 平滑滚到底部。
   *
   * 为什么不用原生 smooth scroll：
   * - 浏览器在动画开始时就会锁定目标位置。
   * - 如果动画期间内容继续增长，最终停下的位置往往会落后最新底部。
   *
   * 当前策略：
   * - 每帧重新读取最新底部 `getBottomTop`。
   * - 如果目标变化，就把“当前位置”当作新的起点继续追。
   * - 相当于把一次长动画拆成多个动态更新的小段动画。
   *
   * 结果：
   * - 对流式输出更稳定
   * - 对消息换行 / 图片加载 / DOM 高度变化更鲁棒
   * - 视觉上仍然是连续平滑的
   */
  function animateScrollToBottom(scrollEl, { force = false, duration = 220 } = {}) {
    if (!scrollEl) return
    if (!force && (!state.autoScrollEnabled || isUserInteractionActive())) return

    prepareAutoScroll()

    const segmentDuration = Math.max(duration, 140)
    let anchorTop = scrollEl.scrollTop
    let targetTop = getBottomTop(scrollEl)
    let startTime = performance.now()

    const step = (now) => {
      smoothScrollRafId = null

      if (!scrollEl) return
      if (!force && isUserInteractionActive()) return

      const latestTargetTop = getBottomTop(scrollEl)

      // 底部在动画期间发生变化时，重置这一段动画的起点与目标。
      if (Math.abs(latestTargetTop - targetTop) > 0.5) {
        anchorTop = scrollEl.scrollTop
        targetTop = latestTargetTop
        startTime = now
      }

      const distance = targetTop - anchorTop
      const progress = Math.min((now - startTime) / segmentDuration, 1)

      // easeOutCubic：前快后慢，适合“追到底部”这类动效。
      const eased = 1 - Math.pow(1 - progress, 3)
      const nextTop = anchorTop + distance * eased

      scrollEl.scrollTop = progress < 1 ? Math.min(nextTop, targetTop) : targetTop
      updateByPosition(scrollEl, { allowButton: false })

      if (isNearBottom(scrollEl)) {
        jumpToBottom(scrollEl)
        return
      }

      smoothScrollRafId = requestAnimationFrame(step)
    }

    smoothScrollRafId = requestAnimationFrame(step)
  }

  /**
   * 立即回到底部。
   *
   * 与 `animateScrollToBottom` 的区别：
   * - 这个方法不做中间动画，直接纠正到最终位置
   * - 适合首屏初始化、强制回底部等场景
   */
  function scrollToBottom(scrollEl, force = false) {
    if (!scrollEl) return
    if (!force && (!state.autoScrollEnabled || isUserInteractionActive())) return

    prepareAutoScroll()
    jumpToBottom(scrollEl)
  }

  /**
   * 把多次连续“新消息到来”合并到下一帧统一处理。
   *
   * 原理：
   * - 流式输出时，短时间内可能连续追加很多次文本。
   * - 如果每次追加都立刻启动滚动，会产生大量重复动画。
   * - 因此这里只保留下一帧的一次滚动调度。
   */
  function scheduleFollowToBottom(scrollEl) {
    if (!scrollEl || isUserInteractionActive() || followRafId) return

    followRafId = requestAnimationFrame(() => {
      followRafId = null

      if (isUserInteractionActive() || !state.autoScrollEnabled) return

      animateScrollToBottom(scrollEl, { duration: 220 })
    })
  }

  // =====================
  // 新消息驱动
  // =====================

  /**
   * 有新消息进入时调用。
   *
   * 新消息的职责只有两个：
   * - 允许自动跟随时，调度追底
   * - 不允许自动跟随时，更新是否仍贴近底部
   *
   * 重要约束：
   * - 这里不负责决定“回到底部”按钮显隐
   * - 按钮显隐只由滚动 idle 阶段统一处理
   *
   * 这样可以保证：
   * - 流式渲染不会影响按钮显示规则
   * - 按钮只在不滑动、且距离底部足够远时显示
   */
  function handleNewMessage(scrollEl) {
    if (!scrollEl) return

    if (state.autoScrollEnabled && !isUserInteractionActive()) {
      scheduleFollowToBottom(scrollEl)
      return
    }

    updateByPosition(scrollEl, { allowButton: false })
  }

  // =====================
  // 生命周期清理
  // =====================

  /**
   * 组件销毁时统一清理，避免计时器与动画帧泄漏。
   *
   * 这是控制器对外暴露的最后一个生命周期入口：
   * 父组件销毁时调用一次，即可把当前控制器留下的异步副作用全部收干净。
   */
  function destroy() {
    clearTouchReleaseTimer()
    clearScrollIdleTimer()
    cancelScrollRaf()
    cancelFollow()
    cancelSmoothScroll()
  }

  return {
    // 用户交互入口
    onTouchStart: handleTouchStart,
    onPointerDown: handlePointerDown,
    onWheel: handleWheel,
    onScroll: handleScroll,

    // 新消息与自动滚动入口
    onNewMessage: handleNewMessage,
    scrollToBottom,
    animateScrollToBottom,

    // 生命周期清理入口
    destroy,
  }
}
