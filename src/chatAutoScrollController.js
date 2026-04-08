/**
 * 聊天列表自动滚动控制器。
 *
 * 约束：
 * 1. 用户一旦开始手动滚动，自动滚动必须立即让出控制权。
 * 2. 不依赖 `touchend` / `pointerup` 恢复自动滚动。
 * 3. “回到底部”按钮只在“离底部超过阈值”且“滚动停稳后”才显示。
 */
export function createChatAutoScrollController({
  state,
  bottomThreshold = 24,
  showButtonOffset = 160,
  touchReleaseDelay = 300,
  scrollIdleDelay = 180,
}) {
  let scrollRafId = null
  let followRafId = null
  let smoothScrollRafId = null
  let touchReleaseTimer = null
  let scrollIdleTimer = null

  // =====================
  // 位置计算
  // =====================

  /** 返回当前距离底部的像素距离。 */
  function getDistanceToBottom(scrollEl) {
    if (!scrollEl) return 0
    return Math.max(scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight, 0)
  }

  /** 返回滚动容器的底部 `scrollTop`。 */
  function getBottomTop(scrollEl) {
    if (!scrollEl) return 0
    return Math.max(scrollEl.scrollHeight - scrollEl.clientHeight, 0)
  }

  /** 当前是否已经接近底部。 */
  function isNearBottom(scrollEl) {
    return getDistanceToBottom(scrollEl) <= bottomThreshold
  }

  /** 当前是否仍由用户手动接管滚动。 */
  function isUserInteractionActive() {
    return state.isUserInteracting
  }

  /**
   * 按当前位置同步外部状态。
   *
   * - `autoScrollEnabled`：是否允许新消息继续自动跟随
   * - `showBackToBottom`：是否显示“回到底部”按钮
   */
  function updateByPosition(scrollEl, { allowButton = true } = {}) {
    const distance = getDistanceToBottom(scrollEl)

    state.autoScrollEnabled = distance <= bottomThreshold

    if (allowButton) {
      state.showBackToBottom = distance > showButtonOffset
    }
  }

  // =====================
  // 清理工具
  // =====================

  /** 清理模拟抬手计时器。 */
  function clearTouchReleaseTimer() {
    if (!touchReleaseTimer) return
    clearTimeout(touchReleaseTimer)
    touchReleaseTimer = null
  }

  /** 清理滚动停稳计时器。 */
  function clearScrollIdleTimer() {
    if (!scrollIdleTimer) return
    clearTimeout(scrollIdleTimer)
    scrollIdleTimer = null
  }

  /** 取消 scroll 的帧合并任务。 */
  function cancelScrollRaf() {
    if (!scrollRafId) return
    cancelAnimationFrame(scrollRafId)
    scrollRafId = null
  }

  /** 取消下一帧的自动追底调度。 */
  function cancelFollow() {
    if (!followRafId) return
    cancelAnimationFrame(followRafId)
    followRafId = null
  }

  /** 取消当前平滑滚动动画。 */
  function cancelSmoothScroll() {
    if (!smoothScrollRafId) return
    cancelAnimationFrame(smoothScrollRafId)
    smoothScrollRafId = null
  }

  /** 停止所有自动滚动行为，把控制权让回给用户。 */
  function stopAutoScroll() {
    cancelFollow()
    cancelSmoothScroll()
  }

  /** 开始一次新的自动滚动前，先清理旧状态。 */
  function prepareAutoScroll() {
    clearTouchReleaseTimer()
    clearScrollIdleTimer()
    stopAutoScroll()
  }

  // =====================
  // 用户交互
  // =====================

  /**
   * `touchstart` 后延迟一段时间，模拟“抬手”。
   *
   * 这是一个刻意简化的策略：
   * - 不依赖 `touchend` / `pointerup`
   * - 只在触摸开始时启动一次 300ms 释放计时器
   */
  function scheduleInteractionRelease(scrollEl) {
    clearTouchReleaseTimer()
    touchReleaseTimer = setTimeout(() => {
      touchReleaseTimer = null
      state.isUserInteracting = false
      updateByPosition(scrollEl, { allowButton: !scrollIdleTimer })
    }, touchReleaseDelay)
  }

  /**
   * 滚动停稳后再决定按钮显隐。
   *
   * 这样可以避免按钮在滚动过程中频繁闪烁。
   */
  function scheduleScrollIdle(scrollEl) {
    clearScrollIdleTimer()
    scrollIdleTimer = setTimeout(() => {
      scrollIdleTimer = null

      if (isUserInteractionActive()) return

      updateByPosition(scrollEl)
    }, scrollIdleDelay)
  }

  /** 进入用户手动接管状态。 */
  function activateUserInteraction() {
    stopAutoScroll()
    clearScrollIdleTimer()

    state.isUserInteracting = true
    state.autoScrollEnabled = false
  }

  /** 触摸开始：立刻让出自动滚动，并启动模拟抬手计时。 */
  function handleTouchStart(scrollEl) {
    activateUserInteraction()
    scheduleInteractionRelease(scrollEl)
  }

  /** 指针按下：立刻进入手动接管。 */
  function handlePointerDown() {
    activateUserInteraction()
  }

  /** 滚轮滚动：立刻进入手动接管。 */
  function handleWheel() {
    activateUserInteraction()
  }

  // =====================
  // 滚动事件
  // =====================

  /**
   * 处理滚动事件。
   *
   * 职责只有三件事：
   * 1. 滚动中隐藏“回到底部”按钮
   * 2. 在停稳后重新判断按钮显隐
   * 3. 把高频 scroll 合并到一帧内同步位置
   */
  function handleScroll(scrollEl) {
    if (!scrollEl) return

    state.showBackToBottom = false
    scheduleScrollIdle(scrollEl)

    if (scrollRafId) return

    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = null
      updateByPosition(scrollEl, { allowButton: false })
    })
  }

  // =====================
  // 自动追底
  // =====================

  /** 直接跳到底部，并同步状态。 */
  function jumpToBottom(scrollEl) {
    if (!scrollEl) return
    scrollEl.scrollTop = getBottomTop(scrollEl)
    updateByPosition(scrollEl)
  }

  /**
   * 平滑滚到底部。
   *
   * 不使用原生 smooth scroll，原因是流式输出期间底部会持续变化。
   * 这里每帧都重新读取最新底部，这样滚动目标能持续追随内容增长。
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

      if (Math.abs(latestTargetTop - targetTop) > 0.5) {
        anchorTop = scrollEl.scrollTop
        targetTop = latestTargetTop
        startTime = now
      }

      const distance = targetTop - anchorTop
      const progress = Math.min((now - startTime) / segmentDuration, 1)
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

  /** 直接滚到底部，不做中间动画。 */
  function scrollToBottom(scrollEl, force = false) {
    if (!scrollEl) return
    if (!force && (!state.autoScrollEnabled || isUserInteractionActive())) return

    prepareAutoScroll()
    jumpToBottom(scrollEl)
  }

  /**
   * 把多次新消息合并到下一帧，只触发一次追底。
   *
   * 这样可以减少流式输出时的重复动画启动。
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
   * 有新消息进入时：
   * - 允许自动跟随就调度追底
   * - 不允许自动跟随时，按“是否仍在手动交互”决定是否更新按钮
   *
   * 这里的关键是：
   * - 用户手动交互期间，不主动显示按钮，避免滚动中闪烁
   * - 一旦用户已不在交互中，就应基于当前位置事实立即决定按钮显隐
   *   否则流式内容持续增长时，按钮会一直卡在旧状态，直到再次滚动才刷新
   */
  function handleNewMessage(scrollEl) {
    if (!scrollEl) return

    if (state.autoScrollEnabled && !isUserInteractionActive()) {
      scheduleFollowToBottom(scrollEl)
      return
    }

    updateByPosition(scrollEl, {
      allowButton: !isUserInteractionActive() && !scrollIdleTimer,
    })
  }

  /** 组件销毁时统一清理所有异步句柄。 */
  function destroy() {
    clearTouchReleaseTimer()
    clearScrollIdleTimer()
    cancelScrollRaf()
    cancelFollow()
    cancelSmoothScroll()
  }

  return {
    onTouchStart: handleTouchStart,
    onPointerDown: handlePointerDown,
    onWheel: handleWheel,
    onScroll: handleScroll,
    onNewMessage: handleNewMessage,
    scrollToBottom,
    animateScrollToBottom,
    destroy,
  }
}
