/**
 * 聊天列表自动滚动控制器
 *
 * 目标：
 * 1. 默认自动跟随到底部。
 * 2. 用户手动滚动时，立即暂停自动跟随。
 * 3. 回到底部按钮只在停止滚动后显示。
 * 4. 保持实现简单、稳定、易读。
 */
export function createChatAutoScrollController({
  state,
  bottomThreshold = 24,
  showButtonOffset = 160,
  touchReleaseDelay = 280,
  scrollIdleDelay = 180,
}) {
  let scrollRafId = null
  let followRafId = null
  let touchReleaseTimer = null
  let scrollIdleTimer = null

  /** 获取距离底部的剩余像素 */
  function getDistanceToBottom(scrollEl) {
    if (!scrollEl) return 0
    return Math.max(scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight, 0)
  }

  /** 是否已经在底部附近 */
  function isAtBottom(scrollEl) {
    return getDistanceToBottom(scrollEl) <= bottomThreshold
  }

  /**
   * 按当前位置同步状态。
   * allowButton=false 时，仅更新是否允许自动跟随，不更新按钮显隐。
   */
  function updateByPosition(scrollEl, { allowButton = true } = {}) {
    const distance = getDistanceToBottom(scrollEl)

    state.autoScrollEnabled = distance <= bottomThreshold

    if (allowButton) {
      state.showBackToBottom = distance > showButtonOffset
    }
  }

  /** 清理用户手动接管保护期定时器 */
  function clearTouchReleaseTimer() {
    if (!touchReleaseTimer) return
    clearTimeout(touchReleaseTimer)
    touchReleaseTimer = null
  }

  /** 清理“滚动停止后再显示按钮”的定时器 */
  function clearScrollIdleTimer() {
    if (!scrollIdleTimer) return
    clearTimeout(scrollIdleTimer)
    scrollIdleTimer = null
  }

  /** 清理下一帧 follow 调度 */
  function cancelFollow() {
    if (!followRafId) return
    cancelAnimationFrame(followRafId)
    followRafId = null
  }

  /** 清理所有自动滚动相关调度 */
  function stopAutoScroll() {
    cancelFollow()
  }

  /**
   * 启动/刷新用户手动接管保护期。
   *
   * 不依赖不稳定的 touchend，而是采用：
   * touchstart / wheel / pointerdown 上锁，scroll 空闲一段时间后解锁。
   */
  function scheduleTouchRelease(scrollEl) {
    clearTouchReleaseTimer()
    touchReleaseTimer = setTimeout(() => {
      touchReleaseTimer = null
      state.isTouching = false
      updateByPosition(scrollEl)
    }, touchReleaseDelay)
  }

  /** 滚动停止一小段时间后，再决定是否显示回到底部按钮 */
  function scheduleScrollIdle(scrollEl) {
    clearScrollIdleTimer()
    scrollIdleTimer = setTimeout(() => {
      scrollIdleTimer = null
      updateByPosition(scrollEl)
    }, scrollIdleDelay)
  }

  /** 统一进入手动接管态 */
  function lockManualInteraction(scrollEl) {
    stopAutoScroll()
    clearScrollIdleTimer()
    state.isTouching = true
    state.autoScrollEnabled = false
    scheduleTouchRelease(scrollEl)
  }

  /** 移动端手指接触滚动区 */
  function onTouchStart(scrollEl) {
    lockManualInteraction(scrollEl)
  }

  /** PC 端鼠标按下滚动区或拖动滚动条前 */
  function onPointerDown(scrollEl) {
    lockManualInteraction(scrollEl)
  }

  /** PC 端滚轮滚动前 */
  function onWheel(scrollEl) {
    lockManualInteraction(scrollEl)
  }

  /**
   * 处理滚动事件。
   *
   * 逻辑：
   * - 滚动中隐藏按钮。
   * - 停止滚动后再决定是否显示按钮。
   * - 如果当前处于手动接管期，则继续延长保护期。
   * - 用 rAF 合并高频更新。
   */
  function onScroll(scrollEl) {
    if (!scrollEl) return

    state.showBackToBottom = false
    scheduleScrollIdle(scrollEl)

    if (state.isTouching) {
      scheduleTouchRelease(scrollEl)
    }

    if (scrollRafId) return

    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = null
      updateByPosition(scrollEl, { allowButton: false })
    })
  }

  /** 按钮点击或首屏进入时使用的平滑回底动画 */
  function animateScrollToBottom(scrollEl, { force = false, duration = 200 } = {}) {
    if (!scrollEl) return
    if (!force && (!state.autoScrollEnabled || state.isTouching)) return

    clearTouchReleaseTimer()
    stopAutoScroll()

    scrollEl.scrollTo({
      top: scrollEl.scrollHeight,
      behavior: 'smooth',
    })

    clearScrollIdleTimer()
    scrollIdleTimer = setTimeout(() => {
      scrollIdleTimer = null
      updateByPosition(scrollEl)
    }, Math.max(duration, scrollIdleDelay))
  }

  /** 立即贴到底部 */
  function scrollToBottom(scrollEl, force = false) {
    if (!scrollEl) return
    if (!force && (!state.autoScrollEnabled || state.isTouching)) return

    clearTouchReleaseTimer()
    stopAutoScroll()
    scrollEl.scrollTop = scrollEl.scrollHeight
    updateByPosition(scrollEl)
  }

  /**
   * 新消息跟随到底部。
   *
   * 为了保持代码简洁和行为稳定，这里不再区分复杂的持续追底模式，
   * 统一走一次轻量的平滑回底。
   */
  function scheduleScrollToBottom(scrollEl) {
    if (!scrollEl || state.isTouching || followRafId) return

    followRafId = requestAnimationFrame(() => {
      followRafId = null

      if (state.isTouching || !state.autoScrollEnabled) return

      animateScrollToBottom(scrollEl, { duration: 220 })
    })
  }

  /** 有新消息进入时调用 */
  function onNewMessage(scrollEl) {
    if (!scrollEl) return

    if (state.autoScrollEnabled && !state.isTouching) {
      scheduleScrollToBottom(scrollEl)
      return
    }

    updateByPosition(scrollEl)
  }

  /** 组件销毁时统一清理 */
  function destroy() {
    clearTouchReleaseTimer()
    clearScrollIdleTimer()
    cancelFollow()

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
    scheduleScrollToBottom,
    destroy,
  }
}
