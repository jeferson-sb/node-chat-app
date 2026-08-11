<template>
  <section class="centered-form">
    <div class="centered-form__box puff-in-center">
      <label>Room</label>
      <form @submit.prevent="joinRoom">
        <input
          type="text"
          name="room"
          v-model="room"
          placeholder="e.g Math, Travel, Academy, ..."
          required
        />
        <button type="submit">Join</button>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const room = ref('')

const joinRoom = (): void => {
  router.push(`/chat/${room.value}`)
}
</script>

<style scoped>
.centered-form {
  background-color: var(--bg-color);
  background-image: url('../assets/bg-illustration.svg');
  background-position: center;
  background-size: cover;
  height: 100vh;
  display: flex;
  justify-content: center;
  align-items: center;
}

.centered-form__box {
  border-radius: 5px;
  background: var(--dark-2);
  padding: 40px;
  width: 420px;
  font-size: 18px;
  box-shadow: 0 2px 10px 0 rgba(0, 0, 0, 0.2);
}

.centered-form input {
  margin-bottom: 16px;
  width: 100%;
  padding: 10px;
  box-sizing: border-box;
  border-radius: 3px;
  border: 1px solid #0000004d;
  background-color: #0000004d;
  color: var(--white);
}

.centered-form input:focus {
  border-color: var(--purple);
}

.centered-form button {
  background: var(--purple);
  font-weight: 600;
  letter-spacing: 1.1px;
  line-height: 16px;
  min-height: 40px;
  width: 100%;
}

.centered-form button:hover {
  background: var(--light-purple);
}

.puff-in-center {
  animation: puff-in-center 0.7s cubic-bezier(0.47, 0, 0.745, 0.715) both;
}
@keyframes puff-in-center {
  0% {
    transform: scale(2);
    filter: blur(2px);
    opacity: 0;
  }
  100% {
    transform: scale(1);
    filter: blur(0px);
    opacity: 1;
  }
}
</style>
