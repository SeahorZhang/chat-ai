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

      <!-- 市面常见：离底部较远时显示按钮；有未读则给出计数 -->
      <button
        v-show="showBackToBottom"
        type="button"
        class="back-to-bottom-btn"
        @click="handleBackToBottom"
      >
        <span>回到底部</span>
        <span v-if="unreadCount > 0" class="badge">{{ unreadCount }}</span>
      </button>

      <div class="message-input-chat">
        <div class="roll-scroll">横向滚动按钮</div>
        <div class="chat-box">输入框</div>
        <div class="box-tip">内容由AI生成提示</div>
      </div>
    </div>
  </div>
</template>

<script>
import { createChatAutoScrollController } from './chatAutoScrollController'

export default {
  name: 'App',

  data() {
    return {
      /** 聊天消息（示例数据） */
      list: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],

      /** 是否允许自动跟随到底部 */
      autoScrollEnabled: true,

      /** 移动端是否正在触摸滚动 */
      isTouching: false,

      /** 是否显示“回到底部”按钮 */
      showBackToBottom: false,

      /** 用户离开底部期间累积的新消息数 */
      unreadCount: 0,

      /** 自动滚动 rAF id */
      rafId: null,

      /** 滚动事件节流 rAF id */
      scrollRafId: null,

      /** 模拟流式输出定时器 */
      streamTimer: null,

      /** 自动滚动控制器 */
      autoScroller: null,
    }
  },

  mounted() {
    // 创建控制器：参数保持简洁，便于理解和维护
    this.autoScroller = createChatAutoScrollController({
      state: this,
      bottomThreshold: 24,
      showButtonOffset: 160,
    })

    // 首次进入强制到底
    this.autoScroller.scrollToBottom(this.$refs.scrollEl, true)

    // 模拟 AI 流式输出
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
  },

  methods: {
    /** 滚动中：同步底部状态（内部已做 rAF 节流） */
    onScroll() {
      this.autoScroller.onScroll(this.$refs.scrollEl)
    },

    /** 手指按下：立即停止自动跟随 */
    onTouchStart() {
      this.autoScroller.onTouchStart()
    },

    /** 手指抬起：根据位置决定是否恢复自动跟随 */
    onTouchEnd() {
      this.autoScroller.onTouchEnd(this.$refs.scrollEl)
    },

    /** 点击按钮：强制到底 + 恢复跟随 */
    handleBackToBottom() {
      this.autoScrollEnabled = true
      this.autoScroller.scrollToBottom(this.$refs.scrollEl, true)
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

    .back-to-bottom-btn {
      position: absolute;
      right: 18px;
      bottom: 120px;
      z-index: 10;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      border: none;
      border-radius: 999px;
      padding: 10px 14px;
      background: #111;
      color: #fff;
      font-size: 13px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
      opacity: 0.95;
    }

    .back-to-bottom-btn .badge {
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      border-radius: 9px;
      background: #ff4d4f;
      color: #fff;
      font-size: 11px;
      line-height: 18px;
      text-align: center;
    }

    .back-to-bottom-btn:active {
      transform: scale(0.98);
      opacity: 1;
    }
  }
}
</style>
