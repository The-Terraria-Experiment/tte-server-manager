<template>
	<div class="flex items-center justify-center min-h-screen bg-gray-2">
		<div class="overflow-hidden w-max rounded-2xl" id="authWrapper">
			<div class="federated-buttons p-4 pb-0 bg-gray-3">
				<h2 class="text-center mb-2 text-cream font-main font-bold">SIGN IN WITH PROVIDER</h2>
				<GoogleSignInButton />
				<PatreonSignInButton />
				<div class="m-6"></div>
				<hr class="amplify-divider amplify-divider--horizontal amplify-divider--small" aria-orientation="horizontal" data-label="or" />
			</div>
			<Authenticator :formFields="formFields">
				<template v-slot="{user}">
					<!-- This won't be shown because we redirect on auth change -->
				</template>
			</Authenticator>
		</div>
	</div>
</template>

<script setup>
import { Authenticator } from "@aws-amplify/ui-vue";
import { Hub } from "aws-amplify/utils";
import { I18n } from "aws-amplify/utils";
import "@aws-amplify/ui-vue/styles.css";
import { onMounted, onUnmounted } from "vue";
import { useUserStore } from "../../stores/userStore";
import { useRouter } from "vue-router";
import { useAlerts } from "../../util/alerts";
import PatreonSignInButton from "../shared/PatreonSignInButton.vue";
import GoogleSignInButton from "../shared/GoogleSignInButton.vue";

const FEDERATED_SIGN_IN_ERROR_MESSAGES = {
	patreon_email_unverified: "Your Patreon email must be verified at Patreon before you can sign in with it",
};

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

const alerts = useAlerts();
let unsubscribeHub;

onMounted(async () => {
	const userStore = useUserStore();
	const router = useRouter();

	unsubscribeHub = Hub.listen("auth", ({ payload }) => {
		if (payload.event !== "signInWithRedirect_failure") return;

		const message = payload.data?.error?.message;
		alerts.error(FEDERATED_SIGN_IN_ERROR_MESSAGES[message] || "Sign in failed. Please try again.");
	});

	await userStore.loadUser();

	if (userStore.isAuthenticated) {
		router.push("/");
	}
});

onUnmounted(() => {
	unsubscribeHub?.();
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
