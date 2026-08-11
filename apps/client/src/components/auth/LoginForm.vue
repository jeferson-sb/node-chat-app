<template>
  <form @submit.prevent="onSubmit">
    <label>Email</label>
    <input
      v-model="email"
      type="email"
      placeholder="you@example.com"
      required
    />
    <label>Password</label>
    <input
      v-model="password"
      type="password"
      placeholder="Your password"
      required
    />
    <p v-if="error" class="auth-form__error">{{ error }}</p>
    <button type="submit">Log in</button>
  </form>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { authClient } from '../../services/auth'

const emit = defineEmits<{ success: [] }>()

const email = ref('')
const password = ref('')
const error = ref('')

const onSubmit = async (): Promise<void> => {
  error.value = ''
  const { error: signInError } = await authClient.signIn.email({
    email: email.value,
    password: password.value,
  })

  if (signInError) {
    error.value = signInError.message ?? 'Unable to log in'
    return
  }

  emit('success')
}
</script>
