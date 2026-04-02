<template><div class="scroll-btns">
  <button @click="$emit('click',1)">1</button>
  <button @click="$emit('click',2)">2</button>
  <button @click="$emit('click',3)">333</button>
  <button @click="$emit('click',4)">4444</button>
</div></template>

<style>
.scroll-btns{
  display: flex;
  button{
    margin-right: 10px;
  }
}
</style>