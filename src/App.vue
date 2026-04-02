<template>
  <div class="qa-container">
    <div class="chat-container" style="padding: 0 10px">
      <div class="title-bg" style="height: 50px"></div>

      <div
        ref="scrollEl"
        class="qa-right-scrollbar"
        @scroll.passive="onScroll"
        @touchstart.passive="onTouchStart"
        @touchend.passive="onTouchEnd"
      >
        <div class="message-list" v-for="item in list" :key="item">
          <div class="talk-item">我发送的---{{ item }}</div>
          <div class="talk-item">机器人回复的---{{ item }}</div>
        </div>
      </div>

      <!-- 按钮固定在输入区正上方中间，位置随输入区高度变化 -->
      <BackToBottomButton
        :visible="showBackToBottom"
        :bottom-offset="backToBottomOffset"
        @click="handleBackToBottom"
      />

      <div ref="inputChatRef" class="message-input-chat">
        <ScrollBtns @click="handleInputHeightChange" />
        <div class="chat-box">输入框</div>
        <div class="box-tip">内容由AI生成提示</div>
      </div>
    </div>
  </div>
</template>

<script>
import { createChatAutoScrollController } from './chatAutoScrollController'
import ScrollBtns from './components/ScrollBtns.vue'
import BackToBottomButton from './components/BackToBottomButton.vue'

const INPUT_TOP_GAP = 12

export default {
  name: 'App',
  components: {
    ScrollBtns,
    BackToBottomButton,
  },

  data() {
    return {
      /** 聊天消息（示例：定时追加） */
      list: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],

      /** 自动滚动状态 */
      autoScrollEnabled: true,
      isTouching: false,
      showBackToBottom: false,

      /** requestAnimationFrame 标识（滚动跟随 + 滚动事件节流） */
      rafId: null,
      scrollRafId: null,

      /** 资源句柄 */
      streamTimer: null,
      autoScroller: null,
      inputResizeObserver: null,

      /** “回到底部”按钮离容器底部的距离 */
      backToBottomOffset: 112,
    }
  },

  mounted() {
    // 初始化自动滚动控制器
    this.autoScroller = createChatAutoScrollController({
      state: this,
      bottomThreshold: 24,
      showButtonOffset: 160,
    })

    // 首屏直接到底
    this.autoScroller.scrollToBottom(this.$refs.scrollEl, true)

    // 让按钮初始位置对齐输入区，并监听后续高度变化
    this.updateBackToBottomOffset()
    this.observeInputHeight()

    // 模拟流式输出
    this.streamTimer = setInterval(() => {
      this.list.push(this.list.length + 1)
      this.autoScroller.onNewMessage(this.$refs.scrollEl)
    }, 200)
  },

  beforeDestroy() {
    if (this.streamTimer) {
      clearInterval(this.streamTimer)
      this.streamTimer = null
    }

    if (this.autoScroller) {
      this.autoScroller.destroy()
      this.autoScroller = null
    }

    if (this.inputResizeObserver) {
      this.inputResizeObserver.disconnect()
      this.inputResizeObserver = null
    }
  },

  methods: {
    /** ScrollBtns 调整输入区高度 */
    handleInputHeightChange(multiplier) {
      this.$refs.inputChatRef.style.height = `${multiplier * 100}px`
    },

    /** 高频滚动事件：内部已做 rAF 节流 */
    onScroll() {
      this.autoScroller.onScroll(this.$refs.scrollEl)
    },

    /** 手动滚动开始：暂停自动跟随 */
    onTouchStart() {
      this.autoScroller.onTouchStart()
    },

    /** 手动滚动结束：根据位置决定是否恢复跟随 */
    onTouchEnd() {
      this.autoScroller.onTouchEnd(this.$refs.scrollEl)
    },

    /** 一键回到底部并恢复自动跟随 */
    handleBackToBottom() {
      this.autoScrollEnabled = true
      this.autoScroller.scrollToBottom(this.$refs.scrollEl, true)
    },

    /** 根据输入区高度更新按钮位置 */
    updateBackToBottomOffset() {
      const inputEl = this.$refs.inputChatRef
      if (!inputEl) return

      this.backToBottomOffset = inputEl.clientHeight + INPUT_TOP_GAP
    },

    /** 监听输入区高度变化，保证按钮始终贴着输入区上方 */
    observeInputHeight() {
      const inputEl = this.$refs.inputChatRef
      if (!inputEl || typeof ResizeObserver === 'undefined') return

      this.inputResizeObserver = new ResizeObserver(() => {
        this.updateBackToBottomOffset()
      })

      this.inputResizeObserver.observe(inputEl)
    },
  },
}
</script>

<style>
html,
body,
#app {
  height: 100%;
  margin: 0;
}

.qa-container {
  height: 100%;
  overflow: hidden;


  .chat-container {
    position: relative;
    display: flex;
    flex-direction: column;
    height: 100%;

    .title-bg {
      background: #000;
    }

    .qa-right-scrollbar {
      flex: 1;
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      overscroll-behavior: contain;
      scroll-behavior: auto;
    }

    .message-input-chat {
      height: 100px;
      background: #ccc;
    }
  }
}
</style>
