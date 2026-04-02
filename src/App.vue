<template>
  <div class="qa-container">
    <div class="chat-container" style="padding: 0 10px">
      <div class="title-bg" style="height:50px"></div>
      <div class="qa-right-scrollbar">
        <div class="message-list" v-for="item in list" :key="item">
          <div class="talk-item">我发送的---{{ item }}</div>
          <div class="talk-item">机器人回复的---{{ item }}</div>
        </div>
      </div>
      <div class="message-input-chat">
        <div class="roll-scroll">横向滚动按钮</div>
        <div class="chat-box">输入框</div>
        <div class="box-tip">内容由AI生成提示</div>
      </div>
    </div>
  </div>
</template>

<script>

export default {
  name: 'App',
  data() {
    return {
      list: [1, 2, 3, 4, 5, 6,7,8,9,10,11,12,13,14]
    }
  },
  mounted() {
    setInterval(() => {
      this.list.push(this.list.length + 1)
    }, 200)
  }
}
</script>

<style>
html,
body,
#app {
  height: 100%;
  margin: 0;
  ;
}

.qa-container {
  height: 100%;
  overflow: hidden;


  .chat-container {
    display: flex;
    flex-direction: column;
    height: 100%;

    .title-bg {
      background: #000;
    }

    .qa-right-scrollbar{
      flex:1;
      overflow-y: auto;
    }

    .message-input-chat{
      height: 100px;
      background: #ccc;
    }
  }

}
</style>