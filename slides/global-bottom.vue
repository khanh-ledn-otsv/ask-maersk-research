<template>
  <footer v-if="$slidev.nav.currentPage > 1 && $slidev.nav.currentPage < 16" class="deck-footer">
    <span class="footer-brand"><img src="/one-logo.svg" alt="ONE" /> ASK ONE · EVIDENCE-LED PROPOSAL</span>
    <span>{{ String($slidev.nav.currentPage).padStart(2, '0') }}</span>
  </footer>
</template>
