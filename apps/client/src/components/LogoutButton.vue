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
  width: 100%;
  margin: 24px 0;
  padding-inline: 24px;
  background: var(--purple);
  font-weight: 600;
  letter-spacing: 1.1px;
  min-height: 40px;
  border-radius: 0;
}

.logout-button:hover {
  background: var(--light-purple);
}

.logout-button__error {
  color: var(--error);
  font-size: 14px;
  padding-inline: 24px;
  margin-block: 8px 0;
}
</style>
