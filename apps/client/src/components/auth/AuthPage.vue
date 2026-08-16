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
  --field-surface: oklch(0% 0 0 / 0.3);
  --box-shadow-color: oklch(0% 0 0 / 0.2);

  container: centered-form / inline-size;
  display: flex;
  justify-content: center;
  align-items: center;
  block-size: 100dvh;
  background-color: var(--bg-color);
  background-image: url('../../assets/bg-illustration.svg');
  background-position: center;
  background-size: cover;
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

.tabs {
  display: flex;
  background: var(--dark);
  border-radius: 3px;
  padding: 0.25rem;
  margin-block-end: 1.5rem;
}

.tabs__item {
  flex: 1;
  background: transparent;
  color: var(--gray);
  font-size: 0.875rem;
  font-weight: 600;
  padding: 0.5rem;

  &:hover {
    background: transparent;
    color: var(--white);
  }

  &.tabs__item--active {
    background: var(--purple);
    color: var(--white);
  }
}

.centered-form :deep(input) {
  inline-size: 100%;
  box-sizing: border-box;
  margin-block-end: 1rem;
  padding: 0.625rem;
  border: 1px solid var(--field-surface);
  border-radius: 3px;
  background-color: var(--field-surface);
  color: var(--white);
}

.centered-form :deep(input:focus) {
  border-color: var(--purple);
}

.centered-form :deep(button[type='submit']) {
  inline-size: 100%;
  min-block-size: 2.5rem;
  background: var(--purple);
  font-weight: 600;
  letter-spacing: 1.1px;
  line-height: 1rem;
}

.centered-form :deep(button[type='submit']:hover) {
  background: var(--light-purple);
}

.centered-form :deep(.auth-form__error) {
  color: var(--error);
  font-size: 0.875rem;
  margin-block: -0.5rem 1rem;
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
