/**
 * 聊天列表自动滚动控制器（适用于移动端流式渲染场景）
 *
 * 设计目标：
 * 1) 默认跟随到底部（AI 流式输出时自动滚动）。
 * 2) 用户手动滑动时立刻暂停自动滚动。
 * 3) 用户再次滑到底部时，自动滚动自动恢复。
 * 4) 尽量减少低端机抖动：使用 requestAnimationFrame 合并多次滚动写入。
 */
export function createChatAutoScrollController({
  /**
   * Vue 响应式状态对象（由组件 data 提供）
   */
  state,
  /**
   * “视为在底部”的误差阈值（像素）
   *
   * 原因：移动端滚动会有小数和回弹，不能严格要求 distance===0。
   */
  bottomThreshold = 24,
}) {
  /**
   * 判断当前滚动容器是否处于底部附近。
   */
  function isAtBottom(scrollEl) {
    if (!scrollEl) return true

    const distanceToBottom =
      scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight

    return distanceToBottom <= bottomThreshold
  }

  /**
   * 根据当前位置更新状态：
   * - 在底部：允许自动滚动，隐藏“返回底部”按钮
   * - 不在底部：暂停自动滚动，显示“返回底部”按钮
   */
  function updateByPosition(scrollEl) {
    const atBottom = isAtBottom(scrollEl)
    state.autoScrollEnabled = atBottom
    state.showBackToBottom = !atBottom
  }

  /**
   * 用户开始触摸时，立即暂停自动滚动。
   */
  function onTouchStart() {
    state.isTouching = true
    state.autoScrollEnabled = false
  }

  /**
   * 用户触摸结束后，如果已在底部，则恢复自动滚动。
   */
  function onTouchEnd(scrollEl) {
    state.isTouching = false
    updateByPosition(scrollEl)
  }

  /**
   * 滚动事件回调：只做状态同步，不在这里做重操作。
   */
  function onScroll(scrollEl) {
    updateByPosition(scrollEl)
  }

  /**
   * 立即滚到底部。
   *
   * @param {HTMLElement | null} scrollEl 滚动容器
   * @param {boolean} force 是否强制滚动（忽略自动滚动开关）
   */
  function scrollToBottom(scrollEl, force = false) {
    if (!scrollEl) return

    if (!force && (!state.autoScrollEnabled || state.isTouching)) {
      return
    }

    scrollEl.scrollTop = scrollEl.scrollHeight
    updateByPosition(scrollEl)
  }

  /**
   * 将“滚到底部”动作延迟到下一帧执行，避免同一帧内重复写 scrollTop。
   */
  function scheduleScrollToBottom(scrollEl) {
    if (!scrollEl) return
    if (state.rafId) return

    state.rafId = requestAnimationFrame(() => {
      state.rafId = null
      scrollToBottom(scrollEl)
    })
  }

  /**
   * 组件销毁时清理 raf，防止内存泄漏。
   */
  function destroy() {
    if (!state.rafId) return

    cancelAnimationFrame(state.rafId)
    state.rafId = null
  }

  return {
    isAtBottom,
    onTouchStart,
    onTouchEnd,
    onScroll,
    scrollToBottom,
    scheduleScrollToBottom,
    destroy,
  }
}
