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
  --field-surface: oklch(0% 0 0 / 0.3);
  --box-shadow-color: oklch(0% 0 0 / 0.2);

  container: centered-form / inline-size;
  display: flex;
  justify-content: center;
  align-items: center;
  block-size: 100dvh;
  background-color: var(--bg-color);
  background-image: url('../assets/bg-illustration.svg');
  background-position: center;
  background-size: cover;

  & input {
    inline-size: 100%;
    box-sizing: border-box;
    margin-block-end: 1rem;
    padding: 0.625rem;
    border: 1px solid var(--field-surface);
    border-radius: 3px;
    background-color: var(--field-surface);
    color: var(--white);

    &:focus {
      border-color: var(--purple);
    }
  }

  & button {
    inline-size: 100%;
    min-block-size: 2.5rem;
    background: var(--purple);
    font-weight: 600;
    letter-spacing: 1.1px;
    line-height: 1rem;

    &:hover {
      background: var(--light-purple);
    }
  }
}

/* Keeps its 420px until the viewport can no longer fit it with its padding. */
.centered-form__box {
  inline-size: min(26.25rem, 100cqi - 6rem);
  padding: 2.5rem;
  border-radius: 5px;
  background: var(--dark-2);
  font-size: 1.125rem;
  box-shadow: 0 2px 10px 0 var(--box-shadow-color);
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
