<template>
	<button
		type="button"
		class="amplify-button amplify-field-group__control amplify-authenticator__federated-button patreon-signin-button"
		data-amplify-button
		@click="signIn"
	>
		<Icon icon="patreon" color="text-white-0" size="5" />
		<span class="amplify-text patreon-signin-text">Sign in with Patreon</span>
	</button>
</template>

<script setup>
import { signInWithRedirect } from "aws-amplify/auth";

function signIn() {
	signInWithRedirect({ provider: { custom: "Patreon" } });
}
</script>

<style scoped>
.patreon-signin-button {
	background: #f96854 !important;
}

.patreon-signin-button:hover {
	background: #e85c48 !important;
}

.patreon-signin-text {
	color: #ffffff !important;
}
</style>
