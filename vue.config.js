const { defineConfig } = require('@vue/cli-service')
module.exports = defineConfig({
  transpileDependencies: true,
  devServer:{
    // 启动时展示本地ip地址
    host: '0.0.0.0'
  }
})
