<template>
  <div class="qa-container">
    <div class="chat-container">
      <header class="chat-header">Mock Streaming Chat</header>

      <!--
        消息滚动区：
        - 监听滚动和触摸事件，用于控制“自动跟随到底部”
        - 用户手动上滑后暂停自动跟随，避免阅读被打断
      -->
      <div
        ref="scrollEl"
        class="qa-right-scrollbar"
        @scroll.passive="onScroll"
        @touchstart.passive="onTouchStart"
        @touchend.passive="onTouchEnd"
      >
        <div class="message-list">
          <div
            v-for="item in messages"
            :key="item.id"
            class="message-row"
            :class="`message-row--${item.role}`"
          >
            <div
              class="message-bubble"
              :class="{ 'message-bubble--thinking': item.thinking }"
            >
              <p class="message-text">{{ item.content }}</p>
              <span v-if="item.streaming" class="typing-caret" />
            </div>
          </div>
        </div>
      </div>

      <!-- 离底部较远时显示“回到底部”按钮 -->
      <BackToBottomButton
        :visible="showBackToBottom"
        :bottom-offset="backToBottomOffset"
        @click="handleBackToBottom"
      />

      <!-- 输入区独立组件 -->
      <div ref="inputChatRef">
        <ChatInput
          v-model="inputText"
          :is-streaming="isStreaming"
          :is-thinking="isThinking"
          @send="handleSend"
          @stop="handleStopGeneration"
        />
      </div>
    </div>
  </div>
</template>

<script>
import { createChatAutoScrollController } from './chatAutoScrollController'
import BackToBottomButton from './components/BackToBottomButton.vue'
import ChatInput from './components/ChatInput.vue'
import { buildMockReply } from './mockReplyData'

/** “回到底部”按钮与输入区顶部的间距（px） */
const INPUT_TOP_GAP = 12

/** 流式分块参数：每次输出 1~3 个字符 */
const CHUNK_MIN = 1
const CHUNK_MAX = 3

export default {
  name: 'App',
  components: {
    BackToBottomButton,
    ChatInput,
  },

  data() {
    return {
      /** 消息列表 */
      messages: [
        {
          id: 1,
          role: 'assistant',
          content: '你好，我是演示机器人。你发消息后，我会先“思考”，再用流式输出逐步回复。',
          streaming: false,
          thinking: false,
        },
      ],

      /** 输入框内容 */
      inputText: '',

      /** 生成状态：isThinking 是 isStreaming 的子阶段（首包前） */
      isStreaming: false,
      isThinking: false,

      /** 自动滚动相关状态 */
      autoScrollEnabled: true,
      isTouching: false,
      showBackToBottom: false,
      rafId: null,
      scrollRafId: null,

      /** 资源句柄 */
      autoScroller: null,
      inputResizeObserver: null,
      backToBottomOffset: 112,
      timerHandles: [],

      /** 消息与会话标识 */
      nextId: 2,
      activeStreamToken: null,
      activeAssistantMessageId: null,
    }
  },

  mounted() {
    // 初始化自动滚动控制器
    this.autoScroller = createChatAutoScrollController({
      state: this,
      bottomThreshold: 24,
      showButtonOffset: 160,
    })

    // 首屏进入时滚到底部，并初始化“回到底部”按钮位置
    this.$nextTick(() => {
      this.autoScroller.scrollToBottom(this.$refs.scrollEl, true)
      this.updateBackToBottomOffset()
      this.observeInputHeight()
    })
  },

  beforeDestroy() {
    // 组件销毁时，清理定时器与动画帧，避免内存泄漏
    this.clearAllTimers()

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
    // =====================
    // 发送与流式生成
    // =====================

    /** 发送用户消息并启动一次新的 assistant 回复流 */
    handleSend() {
      const text = this.inputText.trim()
      if (!text || this.isStreaming) return

      // 1) 立即插入用户消息，降低“点击发送后无反馈”的体感
      this.messages.push({
        id: this.nextId++,
        role: 'user',
        content: text,
        streaming: false,
        thinking: false,
      })

      this.inputText = ''
      this.$nextTick(() => this.autoScroller.onNewMessage(this.$refs.scrollEl))

      // 2) 开始 assistant 的“思考 -> 流式输出”
      this.startAssistantFlow(text)
    },

    /**
     * 启动一轮完整回复流程：
     * - 阶段 A：正在思考（首包过渡）
     * - 阶段 B：流式输出正文
     */
    startAssistantFlow(userText) {
      this.isStreaming = true
      this.isThinking = true

      // token 用于标记“当前这次生成”，避免旧定时器污染新会话
      const token = Symbol('stream-token')
      this.activeStreamToken = token

      // assistant 占位消息（思考态）
      const assistantMessage = {
        id: this.nextId++,
        role: 'assistant',
        content: '正在思考...',
        streaming: true,
        thinking: true,
      }
      this.messages.push(assistantMessage)
      this.activeAssistantMessageId = assistantMessage.id
      this.autoScroller.onNewMessage(this.$refs.scrollEl)

      const fullText = buildMockReply(userText)

      // 首包延迟：模拟模型检索/推理等待
      this.addTimer(() => {
        if (!this.isCurrentToken(token)) return

        this.isThinking = false
        assistantMessage.thinking = false
        assistantMessage.content = ''

        // 进入流式输出阶段
        this.streamStep({ token, message: assistantMessage, fullText, index: 0 })
      }, 500 + Math.floor(Math.random() * 500))
    },

    /**
     * 单步流式输出：
     * - 每次追加 1~3 个字符
     * - 标点后额外停顿，模拟“语义呼吸”
     */
    streamStep({ token, message, fullText, index }) {
      if (!this.isCurrentToken(token) || !message) return

      const chunkSize = CHUNK_MIN + Math.floor(Math.random() * (CHUNK_MAX - CHUNK_MIN + 1))
      const nextPart = fullText.slice(index, index + chunkSize)

      // 全部输出完成
      if (!nextPart) {
        this.finishAssistantFlow(token, message)
        return
      }

      message.content += nextPart
      this.autoScroller.onNewMessage(this.$refs.scrollEl)

      const nextIndex = index + chunkSize
      const lastChar = nextPart.slice(-1)
      const isPauseChar = /[，。！？；,.!?;]/.test(lastChar)
      const delay = isPauseChar
        ? 180 + Math.floor(Math.random() * 120)
        : 25 + Math.floor(Math.random() * 55)

      this.addTimer(() => {
        this.streamStep({ token, message, fullText, index: nextIndex })
      }, delay)
    },

    /** 正常完成一次流式输出 */
    finishAssistantFlow(token, message) {
      if (!this.isCurrentToken(token)) return

      message.streaming = false
      message.thinking = false
      this.isStreaming = false
      this.isThinking = false
      this.activeStreamToken = null
      this.activeAssistantMessageId = null

      this.$nextTick(() => this.autoScroller.onNewMessage(this.$refs.scrollEl))
    },

    /**
     * 用户主动中断生成：
     * - 清除所有待执行定时器
     * - 将当前 assistant 消息标记为停止态
     */
    handleStopGeneration() {
      if (!this.isStreaming) return

      this.clearAllTimers()

      const currentAssistant = this.getActiveAssistantMessage()
      if (currentAssistant) {
        currentAssistant.streaming = false
        currentAssistant.thinking = false

        if (!currentAssistant.content || currentAssistant.content === '正在思考...') {
          currentAssistant.content = '（已停止生成）'
        } else {
          currentAssistant.content += '\n\n（已停止生成）'
        }
      }

      this.isStreaming = false
      this.isThinking = false
      this.activeStreamToken = null
      this.activeAssistantMessageId = null
      this.$nextTick(() => this.autoScroller.onNewMessage(this.$refs.scrollEl))
    },

    /** 获取当前 token 是否仍是活跃会话 */
    isCurrentToken(token) {
      return token && this.activeStreamToken === token
    },

    /** 根据 activeAssistantMessageId 找到当前 assistant 消息 */
    getActiveAssistantMessage() {
      return this.messages.find((msg) => msg.id === this.activeAssistantMessageId)
    },

    // =====================
    // 定时器管理
    // =====================

    /** 注册定时器并纳入统一清理 */
    addTimer(fn, delay) {
      const handle = setTimeout(() => {
        this.timerHandles = this.timerHandles.filter((id) => id !== handle)
        fn()
      }, delay)

      this.timerHandles.push(handle)
      return handle
    },

    /** 清理所有定时器 */
    clearAllTimers() {
      this.timerHandles.forEach((id) => clearTimeout(id))
      this.timerHandles = []
    },

    // =====================
    // 自动滚动与交互事件
    // =====================

    onScroll() {
      this.autoScroller.onScroll(this.$refs.scrollEl)
    },

    onTouchStart() {
      this.autoScroller.onTouchStart()
    },

    onTouchEnd() {
      this.autoScroller.onTouchEnd(this.$refs.scrollEl)
    },

    handleBackToBottom() {
      this.autoScrollEnabled = true
      this.autoScroller.scrollToBottom(this.$refs.scrollEl, true)
    },

    // =====================
    // 输入区高度联动（按钮定位）
    // =====================

    /** 根据输入区高度，更新“回到底部”按钮的底部偏移 */
    updateBackToBottomOffset() {
      const inputEl = this.$refs.inputChatRef
      if (!inputEl) return

      this.backToBottomOffset = inputEl.clientHeight + INPUT_TOP_GAP
    },

    /** 监听输入区高度变化，确保按钮始终贴着输入区上方 */
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

* {
  box-sizing: border-box;
}

.qa-container {
  height: 100%;
  overflow: hidden;
  background: #f5f7fb;
}

.chat-container {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.chat-header {
  height: 52px;
  line-height: 52px;
  padding: 0 16px;
  font-size: 14px;
  color: #1f2937;
  border-bottom: 1px solid #e5e7eb;
  background: #fff;
}

.qa-right-scrollbar {
  flex: 1;
  overflow-y: auto;
  padding: 14px 14px 24px;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  scroll-behavior: auto;
}

.message-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.message-row {
  display: flex;
}

.message-row--user {
  justify-content: flex-end;
}

.message-row--assistant {
  justify-content: flex-start;
}

.message-bubble {
  max-width: min(78%, 720px);
  padding: 10px 12px;
  border-radius: 14px;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.6;
  font-size: 14px;
}

.message-bubble--thinking {
  opacity: 0.9;
}

.message-row--user .message-bubble {
  color: #fff;
  background: #2563eb;
  border-bottom-right-radius: 4px;
}

.message-row--assistant .message-bubble {
  color: #111827;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-bottom-left-radius: 4px;
}

.message-text {
  margin: 0;
  display: inline;
}

.typing-caret {
  display: inline-block;
  width: 8px;
  height: 1em;
  margin-left: 3px;
  border-radius: 2px;
  vertical-align: -2px;
  background: #111827;
  animation: caret-blink 0.9s steps(1) infinite;
}

@keyframes caret-blink {
  0%,
  50% {
    opacity: 1;
  }

  51%,
  100% {
    opacity: 0;
  }
}
</style>
