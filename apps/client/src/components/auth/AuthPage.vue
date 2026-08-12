<template>
  <section class="centered-form">
    <div class="centered-form__box puff-in-center">
      <div class="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'login'"
          :class="['tabs__item', mode === 'login' ? 'tabs__item--active' : '']"
          @click="mode = 'login'"
        >
          Log In
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="mode === 'signup'"
          :class="['tabs__item', mode === 'signup' ? 'tabs__item--active' : '']"
          @click="mode = 'signup'"
        >
          Sign Up
        </button>
      </div>

      <SignupForm v-if="mode === 'signup'" @success="onSuccess" />
      <LoginForm v-else @success="onSuccess" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import LoginForm from './LoginForm.vue'
import SignupForm from './SignupForm.vue'

const mode = ref<'login' | 'signup'>('login')
const router = useRouter()

const onSuccess = (): void => {
  router.push('/room')
}
</script>

<style scoped>
.centered-form {
  background-color: var(--bg-color);
  background-image: url('../../assets/bg-illustration.svg');
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

.tabs {
  display: flex;
  background: var(--dark);
  border-radius: 3px;
  padding: 4px;
  margin-bottom: 24px;
}

.tabs__item {
  flex: 1;
  background: transparent;
  color: var(--gray);
  font-size: 14px;
  font-weight: 600;
  padding: 8px;
}

.tabs__item:hover {
  background: transparent;
  color: var(--white);
}

.tabs__item--active {
  background: var(--purple);
  color: var(--white);
}

.tabs__item--active:hover {
  background: var(--purple);
}

.centered-form :deep(input) {
  margin-bottom: 16px;
  width: 100%;
  padding: 10px;
  box-sizing: border-box;
  border-radius: 3px;
  border: 1px solid #0000004d;
  background-color: #0000004d;
  color: var(--white);
}

.centered-form :deep(input:focus) {
  border-color: var(--purple);
}

.centered-form :deep(button[type='submit']) {
  background: var(--purple);
  font-weight: 600;
  letter-spacing: 1.1px;
  line-height: 16px;
  min-height: 40px;
  width: 100%;
}

.centered-form :deep(button[type='submit']:hover) {
  background: var(--light-purple);
}

.centered-form :deep(.auth-form__error) {
  color: var(--error);
  font-size: 14px;
  margin-top: -8px;
  margin-bottom: 16px;
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
