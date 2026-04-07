/**
 * 聊天列表自动滚动控制器
 *
 * 这个控制器专门解决聊天场景里最常见的三类问题：
 * 1. 新消息流式到来时，需要自动“跟随到底部”。
 * 2. 用户手动滑动时，自动滚动不能和手势抢控制权。
 * 3. “回到底部”按钮的显示时机要稳定，不能边滚边闪。
 *
 * 设计原则：
 * - 自动跟随以“底部位置”为准，不做复杂业务耦合。
 * - 移动端用 touchstart，PC 端用 pointer / wheel，统一进入“手动接管”保护期。
 * - 不依赖不稳定的 touchmove / touchend / touchcancel，
 *   而是改用“touchstart 上锁 + scroll 空闲后解锁”的模型。
 * - scroll、follow、按钮显示 都做节流 / 延迟，减少抖动与性能浪费。
 */
export function createChatAutoScrollController({
  state,
  /** 视为“已经在底部”的容差，避免 1~2px 抖动导致状态频繁切换 */
  bottomThreshold = 24,
  /** 距离底部超过这个值后，才允许展示“回到底部”按钮 */
  showButtonOffset = 160,
  /** 用户 touchstart 后的保护期；保护期内不允许自动跟随抢回控制权 */
  touchReleaseDelay = 280,
  /** scroll 停止多久之后，才重新计算按钮是否显示 */
  scrollIdleDelay = 180,
}) {
  // =====================
  // 内部运行时状态（非响应式）
  // =====================

  /** 用于合并高频 scroll 事件 */
  let isScrollTicking = false
  /** scroll 位置同步的 rAF id */
  let scrollRafId = null
  /** 平滑滚动动画的 rAF id */
  let smoothScrollRafId = null
  /** 新消息到来时，合并多次 follow 请求的 rAF id */
  let followRafId = null
  /** 流式输出期间“持续追底模式”的 rAF id */
  let continuousFollowRafId = null
  /** 用户 touchstart 后的“保护期释放”定时器 */
  let touchReleaseTimer = null
  /** 用来判断“滚动已经停下来”的空闲定时器 */
  let scrollIdleTimer = null
  /** 当前是否存在一个主动执行中的平滑滚动动画 */
  let isAnimatingToBottom = false

  // =====================
  // 基础位置计算
  // =====================

  /**
   * 获取“距离底部还有多少像素”。
   *
   * 原理：
   * scrollHeight = 内容总高度
   * scrollTop = 当前已经滚过的高度
   * clientHeight = 可视区域高度
   *
   * 所以：剩余距离 = scrollHeight - scrollTop - clientHeight
   */
  function getDistanceToBottom(scrollEl) {
    if (!scrollEl) return 0
    return Math.max(scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight, 0)
  }

  /** 是否已经在底部附近 */
  function isAtBottom(scrollEl) {
    return getDistanceToBottom(scrollEl) <= bottomThreshold
  }

  /**
   * 同步滚动相关响应式状态。
   *
   * allowButton = false 时，只更新 autoScrollEnabled，
   * 不更新“回到底部”按钮，适合正在滚动中的阶段，避免按钮闪烁。
   */
  function updateByPosition(scrollEl, { allowButton = true } = {}) {
    const distance = getDistanceToBottom(scrollEl)

    state.autoScrollEnabled = distance <= bottomThreshold

    if (allowButton) {
      state.showBackToBottom = distance > showButtonOffset
    }
  }

  // =====================
  // 定时器与动画帧清理
  // =====================

  /** 取消 touchstart 触发的保护期释放定时器 */
  function clearTouchReleaseTimer() {
    if (!touchReleaseTimer) return
    clearTimeout(touchReleaseTimer)
    touchReleaseTimer = null
  }

  /** 取消“滚动空闲后再显示按钮”的定时器 */
  function clearScrollIdleTimer() {
    if (!scrollIdleTimer) return
    clearTimeout(scrollIdleTimer)
    scrollIdleTimer = null
  }

  /** 取消已经排队但尚未执行的一次性 follow 请求 */
  function cancelFollow() {
    if (!followRafId) return
    cancelAnimationFrame(followRafId)
    followRafId = null
  }

  /** 停止流式期间的“持续追底模式” */
  function stopContinuousFollow() {
    if (!continuousFollowRafId) return
    cancelAnimationFrame(continuousFollowRafId)
    continuousFollowRafId = null
  }

  /**
   * 统一停止“自动滚动相关动作”。
   *
   * 这里会停掉三类动作：
   * 1. 已经开始执行的平滑滚动动画
   * 2. 仅仅排队中、下一帧才会执行的一次性 follow 请求
   * 3. 流式输出期间持续运行的“追底循环”
   *
   * 这样用户一触摸，就不会再被任何形式的自动滚动偷袭。
   */
  function stopAutoScrollMotion() {
    isAnimatingToBottom = false

    if (smoothScrollRafId) {
      cancelAnimationFrame(smoothScrollRafId)
      smoothScrollRafId = null
    }

    cancelFollow()
    stopContinuousFollow()
  }

  // =====================
  // 用户接管保护期
  // =====================

  /**
   * 开启/刷新用户接管保护期。
   *
   * 为什么不用 touchend 来结束？
   * 因为在很多 WebView / 原生滚动容器里，touchmove、touchend、touchcancel
   * 在滚动过程中并不稳定，可能丢失。
   *
   * 所以这里采用更稳定的降级模型：
   * - touchstart：立刻进入用户接管态
   * - 后续 scroll：不断刷新保护期
   * - 一段时间没再 scroll：认为用户/惯性滚动结束，退出接管态
   */
  function scheduleTouchRelease(scrollEl) {
    clearTouchReleaseTimer()

    touchReleaseTimer = setTimeout(() => {
      touchReleaseTimer = null
      state.isTouching = false
      updateByPosition(scrollEl)
    }, touchReleaseDelay)
  }

  /**
   * scroll 停止后再决定按钮是否显示。
   *
   * 原理：
   * 如果边滚边显示按钮，按钮会在滚动过程中频繁闪现，体感很碎。
   * 因此这里采用“scroll idle”策略：
   * - 滚动中：先隐藏按钮
   * - 停下 scrollIdleDelay 毫秒后：再决定是否显示
   */
  function scheduleScrollIdle(scrollEl) {
    clearScrollIdleTimer()

    scrollIdleTimer = setTimeout(() => {
      scrollIdleTimer = null
      updateByPosition(scrollEl)
    }, scrollIdleDelay)
  }

  /** 只在真实滚动阶段隐藏“回到底部”按钮 */
  function hideBackToBottomButton() {
    state.showBackToBottom = false
  }

  /**
   * 用户开始手动接管滚动区。
   *
   * 注意：这里只在 touchstart / pointerdown / wheel 时“上锁”，但不隐藏按钮。
   * 因为用户只是碰到滚动区，不一定真的已经滚动；
   * 按钮应该只在真实 scroll 发生时才隐藏。
   */
  function lockManualInteraction(scrollEl) {
    stopAutoScrollMotion()
    clearScrollIdleTimer()

    state.isTouching = true
    state.autoScrollEnabled = false

    scheduleTouchRelease(scrollEl)
  }

  /** 移动端手指接触滚动区时，进入手动接管保护期 */
  function onTouchStart(scrollEl) {
    lockManualInteraction(scrollEl)
  }

  /** PC 端鼠标按下滚动区或拖动滚动条前，进入手动接管保护期 */
  function onPointerDown(scrollEl) {
    lockManualInteraction(scrollEl)
  }

  /** PC 端滚轮滚动前，提前进入手动接管保护期，避免自动跟随和滚轮冲突 */
  function onWheel(scrollEl) {
    lockManualInteraction(scrollEl)
  }

  // =====================
  // scroll 事件处理
  // =====================

  /**
   * 统一处理真实发生的 scroll 事件。
   *
   * 职责：
   * 1. 隐藏“回到底部”按钮，避免边滚边闪。
   * 2. 刷新 scroll idle 计时器，滚动停止后再决定按钮是否展示。
   * 3. 如果当前处于用户接管期，则继续延长保护期。
   * 4. 用 rAF 合并高频 scroll 更新，降低响应式开销。
   */
  function onScroll(scrollEl) {
    if (!scrollEl) return

    // 只有真实发生滚动时，才隐藏“回到底部”按钮
    hideBackToBottomButton()
    scheduleScrollIdle(scrollEl)

    // 用户接管期间，只要还在滚，就持续刷新保护期
    if (state.isTouching) {
      scheduleTouchRelease(scrollEl)
    }

    // 用 rAF 合并高频 scroll，避免每个 scroll 事件都触发响应式更新
    if (isScrollTicking) return

    isScrollTicking = true
    scrollRafId = requestAnimationFrame(() => {
      isScrollTicking = false
      scrollRafId = null
      updateByPosition(scrollEl, { allowButton: false })
    })
  }

  // =====================
  // 平滑滚动动画
  // =====================

  /**
   * 按钮点击、首次进入等“主动滚到底部”使用的曲线。
   *
   * 特点：
   * - 前半段更有冲劲
   * - 收尾依然平滑
   * - 适合“我就是要快速到底”的明确意图
   */
  function easeOutCubic(progress) {
    return 1 - Math.pow(1 - progress, 3)
  }

  /**
   * 新消息自动跟随使用的曲线。
   *
   * 特点：
   * - 起步更柔和
   * - 跟随感更明显、更丝滑
   * - 更像 AI Chat 在流式输出时的“温柔吸底”
   */
  function easeOutSine(progress) {
    return Math.sin((progress * Math.PI) / 2)
  }

  /**
   * 根据距离自适应 follow 时长。
   *
   * 这里使用“近处敏捷、远处放缓”的非线性映射：
   * - 近距离时，duration 增长慢，避免轻微追加也显得很拖。
   * - 远距离时，duration 增长更明显，保证足够的跟随感。
   *
   * 通过平方根曲线提升近距离手感：
   * rawRatio = distance / maxDistance
   * easedRatio = sqrt(rawRatio)
   */
  function getFollowDuration(scrollEl) {
    const distance = getDistanceToBottom(scrollEl)
    const minDuration = 170
    const maxDuration = 440
    const maxDistance = 720
    const rawRatio = Math.min(distance / maxDistance, 1)
    const easedRatio = Math.sqrt(rawRatio)

    return Math.round(minDuration + (maxDuration - minDuration) * easedRatio)
  }

  /**
   * 平滑滚到底部。
   *
   * 这里有一个关键实现点：
   * 目标 bottom 不是在动画开始时就固定死，而是每一帧都重新计算。
   *
   * 原理：
   * 流式输出时，scrollHeight 会持续增长；
   * 如果只拿动画开始时的 targetTop，那么动画结束时就可能停在“旧底部”。
   *
   * 因此每一帧都动态读取：
   * targetTop = scrollHeight - clientHeight
   * 这样动画会追着“最新底部”走，避免差一点没到底的问题。
   */
  function animateScrollToBottom(
    scrollEl,
    { force = false, duration = 320, easing = easeOutCubic } = {}
  ) {
    if (!scrollEl) return
    if (!force && (!state.autoScrollEnabled || state.isTouching)) return

    clearTouchReleaseTimer()
    stopAutoScrollMotion()
    isAnimatingToBottom = true

    const startTop = scrollEl.scrollTop
    const startTime = performance.now()

    const step = (now) => {
      if (!isAnimatingToBottom) return

      if (!force && state.isTouching) {
        stopAutoScrollMotion()
        return
      }

      const targetTop = Math.max(scrollEl.scrollHeight - scrollEl.clientHeight, 0)
      const distance = targetTop - startTop

      if (Math.abs(distance) <= 1) {
        scrollEl.scrollTop = targetTop
        smoothScrollRafId = null
        isAnimatingToBottom = false
        updateByPosition(scrollEl)
        return
      }

      const progress = Math.min((now - startTime) / duration, 1)
      const nextTop = startTop + distance * easing(progress)

      scrollEl.scrollTop = progress < 1 ? Math.min(nextTop, targetTop) : targetTop
      updateByPosition(scrollEl)

      if (progress < 1) {
        smoothScrollRafId = requestAnimationFrame(step)
        return
      }

      smoothScrollRafId = null
      isAnimatingToBottom = false

      // 结束时再做一次最终对齐，避免因为内容继续增长而差最后一点点。
      scrollEl.scrollTop = Math.max(scrollEl.scrollHeight - scrollEl.clientHeight, 0)
      updateByPosition(scrollEl)
    }

    smoothScrollRafId = requestAnimationFrame(step)
  }

  /**
   * 流式输出期间的“持续追底模式”。
   *
   * 和一次性 follow 的区别：
   * - 一次性 follow：收到一条增量消息，就做一次短动画。
   * - 持续追底：只要流还在输出，就每一帧都朝最新底部逼近。
   *
   * 这种模式更像真实 AI Chat：
   * 内容在持续增长时，底部不是“跳一下再停”，
   * 而是始终被轻柔地吸住。
   *
   * 实现原理：
   * - 每帧重新读取最新 targetTop
   * - 不直接跳到 targetTop，而是按一定比例逼近
   * - 距离越大，单帧步长越大；距离越小，自动减速收尾
   *
   * 这本质上是一个“阻尼追踪”模型，
   * 比反复开短动画更连续，也更不容易抖动。
   */
  function startContinuousFollow(scrollEl) {
    if (!scrollEl || continuousFollowRafId) return

    const step = () => {
      continuousFollowRafId = null

      if (!scrollEl || !state.isStreaming || state.isTouching || !state.autoScrollEnabled) {
        return
      }

      const distance = getDistanceToBottom(scrollEl)

      if (distance <= 0.5) {
        scrollEl.scrollTop = scrollEl.scrollHeight
        updateByPosition(scrollEl)
      } else {
        const minStep = 6
        const maxStep = 48
        const ratio = Math.min(distance / 240, 1)
        const easedRatio = Math.sqrt(ratio)
        const stepSize = Math.min(maxStep, Math.max(minStep, distance * 0.18 + easedRatio * 18))

        scrollEl.scrollTop += Math.min(stepSize, distance)
        updateByPosition(scrollEl)
      }

      if (state.isStreaming && !state.isTouching && state.autoScrollEnabled) {
        continuousFollowRafId = requestAnimationFrame(step)
      }
    }

    continuousFollowRafId = requestAnimationFrame(step)
  }

  /**
   * 新消息到来时的“轻微平滑跟随”。
   *
   * 非流式阶段使用一次性 follow：
   * - 距离很近：更轻、更快
   * - 距离较远：更丝滑、更明显
   *
   * 流式阶段则优先使用“持续追底模式”。
   */
  function animateFollowToBottom(scrollEl) {
    animateScrollToBottom(scrollEl, {
      duration: getFollowDuration(scrollEl),
      easing: easeOutSine,
    })
  }

  /** 立即贴到底部，不走动画 */
  function scrollToBottom(scrollEl, force = false) {
    if (!scrollEl) return
    if (!force && (!state.autoScrollEnabled || state.isTouching)) return

    clearTouchReleaseTimer()
    stopAutoScrollMotion()

    scrollEl.scrollTop = scrollEl.scrollHeight
    updateByPosition(scrollEl)
  }

  /**
   * 合并多次“跟随到底部”请求。
   *
   * 原理：
   * 流式输出时，一条消息可能在极短时间内触发很多次 onNewMessage。
   * 如果每次都立刻开动画，会造成：
   * - 动画不断打断重启
   * - 主线程压力变大
   * - 视觉上反而更抖
   *
   * 所以这里先合并到下一帧，只保留一次 follow 请求。
   */
  function scheduleScrollToBottom(scrollEl) {
    if (!scrollEl || state.isTouching || followRafId || smoothScrollRafId || continuousFollowRafId) {
      return
    }

    followRafId = requestAnimationFrame(() => {
      followRafId = null

      if (state.isTouching || !state.autoScrollEnabled) return

      if (state.isStreaming) {
        startContinuousFollow(scrollEl)
        return
      }

      animateFollowToBottom(scrollEl)
    })
  }

  /**
   * 当有新消息进入列表时调用。
   *
   * 逻辑：
   * - 如果当前允许自动跟随，尝试合并并执行一次 follow。
   * - 如果当前是手动浏览状态，则只刷新底部位置与按钮状态，不主动滚动。
   */
  function onNewMessage(scrollEl) {
    if (!scrollEl) return

    if (state.autoScrollEnabled && !state.isTouching) {
      scheduleScrollToBottom(scrollEl)
      return
    }

    updateByPosition(scrollEl)
  }

  /** 组件销毁时，统一清理定时器与动画帧 */
  function destroy() {
    clearTouchReleaseTimer()
    clearScrollIdleTimer()
    stopAutoScrollMotion()

    if (scrollRafId) {
      cancelAnimationFrame(scrollRafId)
      scrollRafId = null
    }
  }

  return {
    isAtBottom,
    onTouchStart,
    onPointerDown,
    onWheel,
    onScroll,
    onNewMessage,
    scrollToBottom,
    animateScrollToBottom,
    animateFollowToBottom,
    scheduleScrollToBottom,
    destroy,
  }
}
