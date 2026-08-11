<template>
  <form @submit.prevent="onSubmit">
    <label>Name</label>
    <input v-model="name" type="text" placeholder="Your name" required />
    <label>Email</label>
    <input
      v-model="email"
      type="email"
      placeholder="you@example.com"
      required
    />
    <label>Password</label>
    <input v-model="password" type="password" placeholder="Password" required />
    <p v-if="error" class="auth-form__error">{{ error }}</p>
    <button type="submit">Create account</button>
  </form>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { authClient } from '../../services/auth'

const emit = defineEmits<{ success: [] }>()

const name = ref('')
const email = ref('')
const password = ref('')
const error = ref('')

const onSubmit = async (): Promise<void> => {
  error.value = ''
  const { error: signUpError } = await authClient.signUp.email({
    name: name.value,
    email: email.value,
    password: password.value,
  })

  if (signUpError) {
    error.value = signUpError.message ?? 'Unable to create account'
    return
  }

  emit('success')
}
</script>
