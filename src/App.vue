<template>
  <div class="qa-container">
    <div class="chat-container">
      <header class="chat-header">Mock Streaming Chat</header>

      <!-- 消息列表滚动区：用户滚动时暂停自动跟随 -->
      <div
        ref="scrollEl"
        class="qa-right-scrollbar"
        @scroll.passive="onScroll"
        @touchstart.passive="onTouchStart"
        @pointerdown.passive="onPointerDown"
        @wheel.passive="onWheel"
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
              <p class="message-text" v-html="renderMessageContent(item.content)" />
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

      /** 自动滚动是否仍应跟随最新消息 */
      autoScrollEnabled: true,

      /**
       * 用户是否正在主动与滚动区域交互。
       *
       * 这个命名比 `isTouching` 更准确，因为它覆盖的不只是触摸：
       * - touchstart
       * - pointerdown
       * - wheel
       * - 以及这些输入触发后的一小段“滚动活跃期”
       */
      isUserInteracting: false,

      /** “回到底部”按钮是否显示 */
      showBackToBottom: false,

      /** 自动滚动控制器实例 */
      autoScroller: null,

      /** 输入区高度监听器 */
      inputResizeObserver: null,

      /** “回到底部”按钮距离底部的动态偏移 */
      backToBottomOffset: 112,

      /**
       * 定时器句柄集合。
       *
       * 用 Set 而不是数组：
       * - 新增是 O(1)
       * - 删除已触发的句柄也是 O(1)
       * - 流式输出时会频繁创建小定时器，这样更稳妥
       */
      timerHandles: new Set(),

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
      this.autoScroller.animateScrollToBottom(this.$refs.scrollEl, { force: true, duration: 240 })
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

    /**
     * 发送用户消息并启动一次新的 assistant 回复流。
     *
     * 这里先插入用户消息，再启动 assistant 生成，原因是：
     * - 用户点击发送后，需要立即得到界面反馈
     * - 不必等待“思考态”出现，交互体感更直接
     */
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
     * 启动一轮完整回复流程。
     *
     * 整个生成被拆成两个阶段：
     * - 阶段 A：思考态，用于模拟首包前等待
     * - 阶段 B：流式输出，用于模拟模型逐步吐字
     *
     * token 的作用：
     * - 每次生成都创建唯一 token
     * - 后续异步定时器执行时，先校验自己是否仍属于当前会话
     * - 这样旧会话就不会污染新会话，能避免串流、误写内容等问题
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
     * 单步流式输出。
     *
     * 原理：
     * - 每一轮只追加 1~3 个字符，制造连续输出感
     * - 标点后附加更长停顿，模拟更接近自然语言节奏的“语义呼吸”
     * - 每次追加后都通知自动滚动控制器，由控制器决定是否继续追底
     *
     * 这样拆分后，消息渲染与滚动控制互相解耦：
     * - 当前方法只负责“文本何时增长”
     * - 是否滚动、如何滚动交给独立控制器处理
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
        ? 60 + Math.floor(Math.random() * 60)
        : 8 + Math.floor(Math.random() * 25)

      this.addTimer(() => {
        this.streamStep({ token, message, fullText, index: nextIndex })
      }, delay)
    },

    /**
     * 正常完成一次流式输出，并收尾当前会话状态。
     *
     * 收尾内容包括：
     * - 关闭消息上的 streaming / thinking 标记
     * - 重置组件级别的生成状态
     * - 清空当前活跃会话标识
     * - 在 DOM 更新后再通知滚动控制器做最终位置判断
     */
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

    /**
     * 当前生成会话 token；用于忽略旧定时器。
     *
     * 这是一个轻量级“并发隔离”手段：
     * 只要 token 不匹配，就说明当前回调来自旧任务，必须直接丢弃。
     */
    isCurrentToken(token) {
      return token && this.activeStreamToken === token
    },

    /**
     * 当前正在生成的 assistant 消息。
     *
     * 单独封装成方法的好处：
     * - 读取语义更清楚
     * - 后续若消息结构变化，查找逻辑只需要改一个地方
     */
    getActiveAssistantMessage() {
      return this.messages.find((msg) => msg.id === this.activeAssistantMessageId)
    },

    /**
     * 渲染消息内容。
     *
     * 当前实现直接返回原文，保留一个独立方法主要是为了把“消息数据”与
     * “展示形式”隔开。后续若接 markdown、链接高亮、代码块渲染，只需要
     * 在这里扩展，不必修改模板结构。
     */
    renderMessageContent(content) {
      return content
    },

    // =====================
    // 定时器管理
    // =====================

    /**
     * 注册定时器并纳入统一清理。
     *
     * 性能与结构上的考虑：
     * - 所有异步延迟都走同一个入口，销毁时更容易保证不泄漏
     * - 定时器执行后立即从集合移除，避免句柄越积越多
     */
    addTimer(fn, delay) {
      const handle = setTimeout(() => {
        this.timerHandles.delete(handle)
        fn()
      }, delay)

      this.timerHandles.add(handle)
      return handle
    },

    /**
     * 清理所有定时器。
     *
     * 适用于：
     * - 用户主动停止生成
     * - 组件销毁
     * - 需要终止整轮流式输出时
     */
    clearAllTimers() {
      this.timerHandles.forEach((id) => clearTimeout(id))
      this.timerHandles.clear()
    },

    // =====================
    // 自动滚动与交互事件
    // =====================

    /**
     * 把原生滚动事件转交给自动滚动控制器。
     *
     * 组件层只负责把 DOM 引用传进去，具体的滚动状态机由控制器维护。
     * 这样模板交互与滚动算法解耦，`App.vue` 不必知道内部细节。
     */
    onScroll() {
      this.autoScroller.onScroll(this.$refs.scrollEl)
    },

    /**
     * 用户触摸开始时，通知控制器进入“手动接管”阶段。
     *
     * 这样后续的新消息和自动滚动动画都不会打断用户阅读。
     */
    onTouchStart() {
      this.autoScroller.onTouchStart(this.$refs.scrollEl)
    },

    /**
     * 处理 pointer down，统一兼容鼠标、触控笔等输入设备。
     */
    onPointerDown() {
      this.autoScroller.onPointerDown(this.$refs.scrollEl)
    },

    /**
     * 处理滚轮滚动。
     *
     * 虽然不是触摸输入，但本质上也是用户明确在手动浏览，因此逻辑与触摸一致。
     */
    onWheel() {
      this.autoScroller.onWheel(this.$refs.scrollEl)
    },

    /**
     * 用户点击“回到底部”按钮。
     *
     * 这里会做两件事：
     * - 立刻隐藏按钮，避免动画过程中再次闪现
     * - 强制触发一次滚到底部动画，重新回到自动跟随状态
     */
    handleBackToBottom() {
      this.autoScrollEnabled = true
      this.showBackToBottom = false
      this.autoScroller.animateScrollToBottom(this.$refs.scrollEl, {
        force: true,
        duration: 200,
      })
    },

    // =====================
    // 输入区高度联动（按钮定位）
    // =====================

    /**
     * 根据输入区高度，更新“回到底部”按钮的底部偏移。
     *
     * 原理：
     * - 按钮不是写死在某个固定像素位置
     * - 而是动态贴在输入区上方一小段距离
     * - 这样输入框高度变化时，按钮仍能保持稳定的视觉关系
     */
    updateBackToBottomOffset() {
      const inputEl = this.$refs.inputChatRef
      if (!inputEl) return

      this.backToBottomOffset = inputEl.clientHeight + INPUT_TOP_GAP
    },

    /**
     * 监听输入区高度变化，确保按钮始终贴着输入区上方。
     *
     * 使用 ResizeObserver 的原因：
     * - 输入区高度会随着内容、换行、按钮状态变化而变化
     * - 这类变化不适合靠手动猜测时机更新
     * - 直接观察尺寸变化，响应更准确，也更省心
     */
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
  padding: 14px;
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
