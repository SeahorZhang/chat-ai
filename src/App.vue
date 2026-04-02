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

      <!-- 返回底部按钮：用户离开底部时显示 -->
      <button
        v-show="showBackToBottom"
        type="button"
        class="back-to-bottom-btn"
        @click="handleBackToBottom"
      >
        回到底部
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
      /**
       * 聊天消息列表（这里用数字模拟流式追加）
       */
      list: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],

      /**
       * 自动滚动开关：
       * true  => 新消息到来时自动跟随
       * false => 用户已手动干预，不自动跟随
       */
      autoScrollEnabled: true,

      /**
       * 是否处于触摸中（移动端）
       */
      isTouching: false,

      /**
       * 是否展示“回到底部”按钮
       */
      showBackToBottom: false,

      /**
       * rAF id：用于合并滚动写入，降低低端机压力
       */
      rafId: null,

      /**
       * 模拟流式输出的定时器 id
       */
      streamTimer: null,

      /**
       * 自动滚动控制器实例
       */
      autoScroller: null,
    }
  },

  mounted() {
    // 创建滚动控制器（逻辑与 UI 解耦，便于复用）
    this.autoScroller = createChatAutoScrollController({
      state: this,
      bottomThreshold: 24,
    })

    // 首次渲染强制滚到底部
    this.autoScroller.scrollToBottom(this.$refs.scrollEl, true)

    // 模拟 AI 流式输出：每 200ms 追加一条消息
    this.streamTimer = setInterval(() => {
      this.list.push(this.list.length + 1)

      // 仅在“允许自动滚动 + 非触摸中”时跟随到底部
      if (this.autoScrollEnabled && !this.isTouching) {
        this.autoScroller.scheduleScrollToBottom(this.$refs.scrollEl)
      }
    }, 200)
  },

  beforeDestroy() {
    // 清理定时器
    if (this.streamTimer) {
      clearInterval(this.streamTimer)
      this.streamTimer = null
    }

    // 清理 rAF
    if (this.autoScroller) {
      this.autoScroller.destroy()
      this.autoScroller = null
    }
  },

  methods: {
    /**
     * 滚动事件：同步“是否在底部”的状态
     */
    onScroll() {
      this.autoScroller.onScroll(this.$refs.scrollEl)
    },

    /**
     * 触摸开始：立即停止自动滚动
     */
    onTouchStart() {
      this.autoScroller.onTouchStart()
    },

    /**
     * 触摸结束：如果已到达底部，则恢复自动滚动
     */
    onTouchEnd() {
      this.autoScroller.onTouchEnd(this.$refs.scrollEl)
    },

    /**
     * 点击“回到底部”按钮：强制滚到底部并恢复自动滚动
     */
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
      border: none;
      border-radius: 999px;
      padding: 10px 14px;
      background: #111;
      color: #fff;
      font-size: 13px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
      opacity: 0.92;
    }

    .back-to-bottom-btn:active {
      transform: scale(0.98);
      opacity: 1;
    }
  }
}
</style>
