<template>
  <!--
    返回底部按钮组件（纯展示组件）
    - visible: 控制显隐
    - bottomOffset: 控制距底部偏移（父组件根据输入区高度计算）
  -->
  <transition name="back-to-bottom-fade">
    <button
      v-if="visible"
      type="button"
      class="back-to-bottom-btn"
      :style="buttonStyle"
      @click="$emit('click')"
    >
      回到底部
    </button>
  </transition>
</template>

<script>
export default {
  name: 'BackToBottomButton',
  props: {
    /** 是否显示按钮 */
    visible: {
      type: Boolean,
      default: false,
    },
    /** 按钮距容器底部的偏移（px） */
    bottomOffset: {
      type: Number,
      default: 112,
    },
  },
  computed: {
    /** 将偏移量转换为内联样式 */
    buttonStyle() {
      return {
        bottom: `${this.bottomOffset}px`,
      }
    },
  },
}
</script>

<style>
.back-to-bottom-btn {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  border: none;
  border-radius: 999px;
  padding: 10px 16px;
  background: #111;
  color: #fff;
  font-size: 13px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.2);
  opacity: 0.95;
  will-change: transform, opacity;
}

.back-to-bottom-btn:active {
  transform: translateX(-50%) scale(0.98);
  opacity: 1;
}

.back-to-bottom-fade-enter-active,
.back-to-bottom-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.back-to-bottom-fade-enter,
.back-to-bottom-fade-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px) scale(0.96);
}
</style>
