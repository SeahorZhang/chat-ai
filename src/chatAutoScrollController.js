/**
 * 聊天列表自动滚动控制器（移动端 / 低端机友好）
 *
 * 目标：
 * 1) 新消息流式到来时，默认自动跟随到底部。
 * 2) 用户手动滑动时，立即暂停自动跟随。
 * 3) 用户回到底部后，自动恢复跟随。
 * 4) 提供“返回底部”按钮与未读计数。
 * 5) 用 requestAnimationFrame 合并高频滚动事件，减少卡顿。
 */
export function createChatAutoScrollController({
  // 组件响应式状态（App.vue 的 data）
  state,
  // 判定“已在底部”的容差（px）
  bottomThreshold = 24,
  // 超过该距离才显示“返回底部”按钮（避免轻微滚动就闪现）
  showButtonOffset = 160,
}) {
  // 滚动事件节流标记（非响应式，避免不必要渲染）
  let scrollTicking = false

  /** 获取“距离底部”的像素值 */
  function getDistanceToBottom(scrollEl) {
    if (!scrollEl) return 0
    return scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight
  }

  /** 是否在底部附近 */
  function isAtBottom(scrollEl) {
    return getDistanceToBottom(scrollEl) <= bottomThreshold
  }

  /**
   * 同步状态：
   * - autoScrollEnabled
   * - showBackToBottom
   * - unreadCount（到达底部时清零）
   */
  function updateByPosition(scrollEl) {
    const distance = getDistanceToBottom(scrollEl)
    const atBottom = distance <= bottomThreshold

    state.autoScrollEnabled = atBottom
    state.showBackToBottom = distance > showButtonOffset

    if (atBottom) {
      state.unreadCount = 0
    }
  }

  /** 用户触摸开始：立即停止自动滚动 */
  function onTouchStart() {
    state.isTouching = true
    state.autoScrollEnabled = false
  }

  /** 用户触摸结束：按当前位置恢复状态 */
  function onTouchEnd(scrollEl) {
    state.isTouching = false
    updateByPosition(scrollEl)
  }

  /**
   * 滚动事件（高频）：使用 rAF 节流。
   * 作用：低端机上减少主线程抖动。
   */
  function onScroll(scrollEl) {
    if (!scrollEl) return
    if (scrollTicking) return

    scrollTicking = true
    state.scrollRafId = requestAnimationFrame(() => {
      scrollTicking = false
      state.scrollRafId = null
      updateByPosition(scrollEl)
    })
  }

  /** 立即滚到底部 */
  function scrollToBottom(scrollEl, force = false) {
    if (!scrollEl) return
    if (!force && (!state.autoScrollEnabled || state.isTouching)) return

    scrollEl.scrollTop = scrollEl.scrollHeight
    updateByPosition(scrollEl)
  }

  /** 新消息到来时调用 */
  function onNewMessage(scrollEl) {
    if (!scrollEl) return

    // 满足条件就跟随到底部
    if (state.autoScrollEnabled && !state.isTouching) {
      scheduleScrollToBottom(scrollEl)
      return
    }

    // 非跟随状态下，累计“新消息数”
    state.unreadCount += 1
    updateByPosition(scrollEl)
  }

  /** 合并多次滚动到底部请求 */
  function scheduleScrollToBottom(scrollEl) {
    if (!scrollEl) return
    if (state.rafId) return

    state.rafId = requestAnimationFrame(() => {
      state.rafId = null
      scrollToBottom(scrollEl)
    })
  }

  /** 清理动画帧 */
  function destroy() {
    if (state.rafId) {
      cancelAnimationFrame(state.rafId)
      state.rafId = null
    }

    if (state.scrollRafId) {
      cancelAnimationFrame(state.scrollRafId)
      state.scrollRafId = null
    }
  }

  return {
    isAtBottom,
    onTouchStart,
    onTouchEnd,
    onScroll,
    onNewMessage,
    scrollToBottom,
    scheduleScrollToBottom,
    destroy,
  }
}
