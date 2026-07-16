<template>
	<div class="flex items-center justify-center min-h-screen bg-gray-2">
		<div
			class="overflow-hidden w-max rounded-2xl"
			id="authWrapper"
			ref="authWrapper"
			:class="{ 'auth-submitting': submitting || auth.isPending }"
		>
			<!-- Once Amplify reports "authenticated" its form collapses to the empty default
			     slot, while our provider buttons (own markup) and the loadUser/redirect that
			     follows leave the dialog half-rendered for a moment. Swap the whole dialog for
			     a single loading state until we navigate away. -->
			<div
				v-if="finalizing"
				class="flex flex-col items-center justify-center gap-4 bg-gray-3 min-w-80 px-8 py-24"
			>
				<Spinner class="h-10 w-10 text-teal-4" thickness="3" />
				<p class="font-main font-bold text-cream">Signing you in...</p>
			</div>
			<template v-else>
				<div class="federated-buttons p-4 pb-0 bg-gray-3">
					<h2 class="text-center mb-2 text-cream font-main font-bold">SIGN IN WITH PROVIDER</h2>
					<GoogleSignInButton />
					<PatreonSignInButton />
					<div class="m-6"></div>
					<hr class="amplify-divider amplify-divider--horizontal amplify-divider--small" aria-orientation="horizontal" data-label="or" />
				</div>
				<Authenticator :formFields="formFields">
					<template v-slot="{user}">
						<!-- This won't be shown because we redirect on the signedIn Hub event -->
					</template>
				</Authenticator>
			</template>
		</div>
	</div>
</template>

<script setup>
import { Authenticator, useAuthenticator } from "@aws-amplify/ui-vue";
import { Hub, I18n } from "aws-amplify/utils";
import "@aws-amplify/ui-vue/styles.css";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useUserStore } from "../../stores/userStore";
import { useRouter, useRoute } from "vue-router";
import PatreonSignInButton from "../shared/PatreonSignInButton.vue";
import GoogleSignInButton from "../shared/GoogleSignInButton.vue";
import Spinner from "../common/Spinner.vue";

I18n.putVocabulariesForLanguage('en', {
	'Sign In': "EMAIL LOGIN",
	'Create Account': 'REGISTER',
	'Sign in': 'SIGN IN'
});

const formFields = {
	signIn: {
		username: {
			label: "EMAIL",
			placeholder: "Enter your email",
		},
		password: {
			label: "PASSWORD",
			placeholder: "Enter your password"
		}
	},
	signUp: {
		email: {
			order: 1,
		},
		password: {
			order: 2,
		},
		confirm_password: {
			order: 3,
		},
	},
};

const userStore = useUserStore();
const router = useRouter();
const route = useRoute();

// useAuthenticator() is a shared composable backed by Amplify's auth state machine, so we
// can read its live state here (parent of <Authenticator>) without provide/inject. auth.isPending
// is true only while a network request is in flight - see the submit handling below.
const auth = useAuthenticator();

// True once a sign-in has succeeded (Amplify's form is now gone) but before we've finished
// loading user data and routed away - the window that otherwise shows a half-empty dialog.
const finalizing = computed(() => auth.authStatus === "authenticated");

const redirectToApp = () => {
	const target = route.query.redirect || "/";
	router.push(target);
};

// Amplify's submit buttons never render a spinner (they hardcode loading:false) and only
// enter isPending AFTER client-side validation passes, so a plain isPending spinner feels
// unresponsive - nothing happens on the click itself. Drive our own spinner from the click
// so feedback is instant, then let Amplify's real pending state keep it alive across the
// network request. A max timeout guards against a click that produces no state change.
const authWrapper = ref(null);
const submitting = ref(false);
let resetTimer;
let startGraceTimer;

const stopSubmitting = () => {
	clearTimeout(resetTimer);
	clearTimeout(startGraceTimer);
	submitting.value = false;
};

const startSubmitting = () => {
	submitting.value = true;
	clearTimeout(resetTimer);
	// A real request flips isPending true almost immediately. If it hasn't within this
	// grace window, client-side validation rejected the submit (no network call), so drop
	// the spinner - the form's own error messages take over as feedback.
	clearTimeout(startGraceTimer);
	startGraceTimer = setTimeout(() => {
		if (!auth.isPending) stopSubmitting();
	}, 500);
};

// Clicking a primary submit button, or pressing Enter in a field (which fires a form
// submit without a click), both count as a submit attempt worth reflecting instantly.
const handleAuthClick = (e) => {
	const btn = e.target.closest?.(".amplify-button--primary");
	if (!btn || btn.disabled) return;
	startSubmitting();
};

const handleAuthSubmit = () => {
	startSubmitting();
};

// Once a real request settles (success advances the route, failure sets error), isPending
// drops back to false - clear the spinner. The small floor avoids flicker on a fast request.
watch(
	() => auth.isPending,
	(pending, wasPending) => {
		if (pending || !wasPending || !submitting.value) return;
		clearTimeout(resetTimer);
		resetTimer = setTimeout(stopSubmitting, 250);
	}
);

// The Amplify <Authenticator> signs email users in via in-place API calls (no page
// reload), so onMounted alone can't catch it - listen for the signedIn event and
// redirect off the login page. Federated logins reload the page and are handled by
// onMounted below.
let unsubscribeAuthHub;
onMounted(async () => {
	// Delegated so they survive Amplify re-rendering the form between steps.
	authWrapper.value?.addEventListener("click", handleAuthClick);
	authWrapper.value?.addEventListener("submit", handleAuthSubmit, true);

	unsubscribeAuthHub = Hub.listen("auth", async ({ payload }) => {
		if (payload.event !== "signedIn") return;
		await userStore.loadUser(true);
		redirectToApp();
	});

	await userStore.loadUser();

	if (userStore.isAuthenticated) {
		redirectToApp();
	}
});

onUnmounted(() => {
	unsubscribeAuthHub?.();
	authWrapper.value?.removeEventListener("click", handleAuthClick);
	authWrapper.value?.removeEventListener("submit", handleAuthSubmit, true);
	clearTimeout(resetTimer);
	clearTimeout(startGraceTimer);
});
</script>

<style scoped>
@reference "../../theme.css";

#authWrapper :deep([data-amplify-authenticator]), 
#authWrapper [data-amplify-authenticator],
[data-amplify-authenticator] 
{
	--amplify-components-authenticator-router-background-color: var(--color-gray-3);
	--amplify-components-authenticator-router-border-color: transparent;

	--amplify-components-tabs-item-active-color: var(--color-cream);
	--amplify-components-tabs-item-color: var(--color-gray-6);
	--amplify-components-tabs-item-hover-color: var(--color-gray-8);
	--amplify-components-tabs-item-active-border-color: transparent;
	--amplify-components-tabs-item-border-color: transparent;
	--amplify-components-tabs-border-color: transparent;
	--amplify-components-tabs-panel-padding-block: var(--amplify-space-xs);

	--amplify-components-authenticator-form-padding: var(--amplify-space-medium);

	--amplify-components-divider-label-background-color: var(--color-gray-3);
	--amplify-components-divider-label-color: var(--color-gray-7);

	--amplify-components-input-color: var(--color-cream);
	--amplify-components-input-focus-border-color: var(--color-teal-3);

	--amplify-components-passwordfield-button-hover-background-color: transparent;
	--amplify-components-passwordfield-button-active-background-color: transparent;

	--amplify-components-passwordfield-button-active-border-color: transparent;
	--amplify-components-passwordfield-button-active-border: transparent;
	--amplify-components-passwordfield-button-hover-border-color: transparent;
	--amplify-components-passwordfield-button-disabled-border-color: transparent;

	--amplify-components-passwordfield-button-disabled-color: var(--color-gray-6);
	--amplify-components-passwordfield-button-active-color: transparent;
	--amplify-components-passwordfield-button-color: var(--color-gray-6);
	--amplify-components-passwordfield-button-hover-color: var(--color-teal-5);
	--amplify-components-passwordfield-button-focus-color: var(--color-teal-5);

	--amplify-components-field-label-color: var(--color-gray-7);
}

:deep(.amplify-button) {
	@apply border-0 outline-0 rounded-lg;
}

:deep(.amplify-authenticator__federated-button) {
	@apply bg-white-1 mb-4;
}

/* Amplify renders its own (Google-only) federated button + divider inside the
   sign-in/sign-up forms with no slot to insert Patreon between them and the
   divider - render our own pair above the form instead and hide Amplify's. */
:deep(.amplify-authenticator__federated-buttons) {
	display: none;
}

.federated-buttons :deep(.amplify-authenticator__federated-button) {
	width: 100%;
}

/* Our own divider sits outside [data-amplify-authenticator], so it doesn't pick up
   the theme overrides set above - restate them here to match. */
.federated-buttons .amplify-divider {
	--amplify-components-divider-label-background-color: var(--color-gray-3);
	--amplify-components-divider-label-color: var(--color-gray-7);
	--amplify-components-divider-border-color: var(--color-gray-5);
}

:deep(.amplify-input) {
	@apply rounded-lg! outline-0 bg-gray-4 border-0;
}

:deep(.amplify-button--primary) {
	@apply bg-linear-to-r from-teal-4 to-teal-1 text-cream rounded-lg! mt-4 font-main! font-bold!;
}

/* Amplify hardcodes loading:false on its submit buttons, so they show no spinner. The
   .auth-submitting class is toggled from JS (click + real isPending state, see script) -
   append our own spinner to whichever primary submit button is on screen. */
#authWrapper.auth-submitting :deep(.amplify-button--primary)::after {
	content: "";
	display: inline-block;
	width: 1em;
	height: 1em;
	margin-left: 0.6em;
	vertical-align: -0.15em;
	border: 2px solid currentColor;
	border-right-color: transparent;
	border-radius: 50%;
	animation: authBtnSpin 0.6s linear infinite;
}

@keyframes authBtnSpin {
	to { transform: rotate(360deg); }
}

:deep(.amplify-label) {
	@apply font-main font-bold;
}

:deep(.amplify-text--error) {
	@apply text-red-4
}

:deep(.amplify-authenticator__subtitle) {
	@apply text-gray-8;
}

:deep(.amplify-heading) {
	@apply text-teal-4;
}
</style>
