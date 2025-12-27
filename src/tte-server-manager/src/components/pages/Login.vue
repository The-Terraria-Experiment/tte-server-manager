<template>
	<div class="flex items-center justify-center min-h-screen bg-gray-2">
		<div class="overflow-hidden w-max rounded-2xl" id="authWrapper">
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
import { I18n } from "aws-amplify/utils";
import "@aws-amplify/ui-vue/styles.css";

I18n.putVocabulariesForLanguage('en', {
	'Sign In': "LOGIN",
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

:deep(.amplify-input) {
	@apply rounded-lg! outline-0 bg-gray-4 border-0;
}

:deep(.amplify-button--primary) {
	@apply bg-linear-to-r from-teal-4 to-teal-1 text-cream rounded-lg! mt-4 font-main! font-bold!;
}

:deep(.amplify-label) {
	@apply font-main font-bold;
}
</style>
