<template>
  <p v-if="error" class="logout-button__error">{{ error }}</p>
  <button type="button" class="logout-button" @click="logout">Log out</button>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { authClient } from '../services/auth'

const router = useRouter()
const error = ref('')

const logout = async (): Promise<void> => {
  error.value = ''
  const { error: signOutError } = await authClient.signOut()

  if (signOutError) {
    error.value = signOutError.message ?? 'Unable to log out'
    return
  }

  router.push('/')
}
</script>

<style scoped>
.logout-button {
  inline-size: 100%;
  min-block-size: 2.5rem;
  margin-block: 1.5rem;
  margin-inline: 0;
  padding-inline: 1.5rem;
  background: var(--purple);
  font-weight: 600;
  letter-spacing: 1.1px;
  border-radius: 0;

  &:hover {
    background: var(--light-purple);
  }
}

.logout-button__error {
  color: var(--error);
  font-size: 0.875rem;
  padding-inline: 1.5rem;
  margin-block: 0.5rem 0;
}
</style>
