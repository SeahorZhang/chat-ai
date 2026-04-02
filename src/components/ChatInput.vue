<template>
  <div class="message-input-chat">
    <!-- 输入区：生成中时禁用，避免重复提交 -->
    <textarea
      ref="textareaRef"
      :value="value"
      class="chat-textarea"
      rows="1"
      maxlength="1200"
      placeholder="给我讲一个关于前端性能优化的故事..."
      :disabled="isStreaming"
      @input="handleInput"
      @keydown="handleKeydown"
    />

    <div class="input-footer">
      <!-- 次要文案：根据状态给出清晰提示 -->
      <span class="tip">{{ footerTip }}</span>

      <!--
        主按钮逻辑：
        - 生成中：显示“停止生成”
        - 空输入：禁用“发送”
      -->
      <button
        class="send-btn"
        :class="{ 'send-btn--danger': isStreaming }"
        :disabled="sendButtonDisabled"
        @click="handlePrimaryAction"
      >
        {{ primaryButtonText }}
      </button>
    </div>
  </div>
</template>

<script>
const MAX_TEXTAREA_HEIGHT = 160

export default {
  name: 'ChatInput',
  props: {
    /** v-model 绑定的输入内容 */
    value: {
      type: String,
      default: '',
    },
    /** 是否正在流式生成 */
    isStreaming: {
      type: Boolean,
      default: false,
    },
    /** 是否处于“正在思考”首包过渡期 */
    isThinking: {
      type: Boolean,
      default: false,
    },
  },
  computed: {
    /** 是否可发送（仅在非生成中且有有效输入时为 true） */
    canSend() {
      return !!this.value.trim() && !this.isStreaming
    },
    /** 主按钮文案 */
    primaryButtonText() {
      if (this.isStreaming) return '停止生成'
      return '发送'
    },
    /** 主按钮禁用态（生成中允许点击“停止生成”） */
    sendButtonDisabled() {
      if (this.isStreaming) return false
      return !this.canSend
    },
    /** 底部提示文案 */
    footerTip() {
      if (this.isStreaming) return '正在生成，点击“停止生成”可中断'
      if (this.isThinking) return '模型正在思考，请稍候...'
      return 'Enter 发送，Shift + Enter 换行'
    },
  },
  mounted() {
    this.autoResize()
  },
  watch: {
    /** 输入值变化后重新计算文本域高度 */
    value() {
      this.$nextTick(() => this.autoResize())
    },
  },
  methods: {
    /** 输入时同步到父组件，并进行高度自适应 */
    handleInput(event) {
      this.$emit('input', event.target.value)
      this.autoResize()
    },

    /** 键盘发送逻辑：Enter 发送，Shift+Enter 换行 */
    handleKeydown(event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        this.handlePrimaryAction()
      }
    },

    /** 主按钮行为：根据状态分派“发送 / 停止生成” */
    handlePrimaryAction() {
      if (this.isStreaming) {
        this.$emit('stop')
        return
      }

      if (!this.canSend) return
      this.$emit('send')
    },

    /** 文本域高度自适应（设置上限防止撑爆布局） */
    autoResize() {
      const el = this.$refs.textareaRef
      if (!el) return

      el.style.height = 'auto'
      const nextHeight = Math.min(el.scrollHeight, MAX_TEXTAREA_HEIGHT)
      el.style.height = `${nextHeight}px`
    },
  },
}
</script>

<style>
.message-input-chat {
  padding: 10px 12px 12px;
  border-top: 1px solid #e5e7eb;
  background: #fff;
}

.chat-textarea {
  width: 100%;
  min-height: 42px;
  max-height: 160px;
  resize: none;
  border: 1px solid #d1d5db;
  border-radius: 12px;
  padding: 10px 12px;
  font-size: 14px;
  line-height: 1.5;
  outline: none;
}

.chat-textarea:focus {
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
}

.chat-textarea:disabled {
  background: #f3f4f6;
  color: #6b7280;
}

.input-footer {
  margin-top: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.tip {
  color: #6b7280;
  font-size: 12px;
}

.send-btn {
  height: 34px;
  min-width: 92px;
  border: none;
  border-radius: 10px;
  padding: 0 14px;
  color: #fff;
  background: #2563eb;
  cursor: pointer;
}

.send-btn--danger {
  background: #dc2626;
}

.send-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
</style>
