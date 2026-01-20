<template>
	<div class="pointer-events-none fixed left-0 right-0 top-4 z-50 flex justify-center">
		<div class="w-full max-w-3xl px-4">
			<TransitionGroup name="alert" tag="div" class="space-y-3">
				<div
					v-for="alert in alerts"
					:key="alert.id"
					class="pointer-events-auto rounded-xl px-4 py-3 shadow-lg shadow-gray-0 backdrop-blur"
					:class="typeClasses(alert.type)"
					role="status"
					aria-live="polite"
				>
					<div class="flex items-stretch gap-3">
						<Icon :icon="typeIcon(alert.type)" :color="iconColor(alert.type)" size="4" class="mt-0.5" />
						<div class="flex-1">
							<p class="text-sm font-main font-bold leading-5">{{ labelFor(alert.type) }}</p>
							<p class="text-sm leading-5 text-cream">{{ alert.message }}</p>
							<p v-if="alert.description" class="mt-1 text-xs leading-5 text-gray-600">{{ alert.description }}</p>
						</div>
						<div
							class="flex items-center"
							v-if="alert.dismissible"
						>
							<button
								class="p-2 rounded"
								type="button"
								aria-label="Dismiss alert"
								@click="dismiss(alert.id)"
							>
								<Icon icon="xmark" class="cursor-pointer" size="4" color="text-white-0" />
							</button>
						</div>
					</div>
				</div>
			</TransitionGroup>
		</div>
	</div>
</template>

<script setup>
import { storeToRefs } from 'pinia'
import { useAlertStore } from '../../stores/alertStore'
import Icon from './Icon.vue';

const store = useAlertStore();
const { alerts } = storeToRefs(store);

const dismiss = (id) => store.remove(id);

const labelFor = (type) => {
	switch (type) {
		case 'success':
			return 'SUCCESS';
		case 'error':
			return 'ERROR';
		case 'warning':
			return 'WARNING';
		default:
			return 'NOTICE';
	}
};

const typeClasses = (type) => {
	switch (type) {
		case 'success':
			return 'bg-linear-to-r from-green-4 to-green-2 text-white-1';
		case 'error':
			return 'bg-linear-to-r from-red-2 to-red-0 text-white-1';
		case 'warning':
			return 'bg-linear-to-r from-yellow-600 to-yellow-700 text-white-1';
		default:
			return 'bg-linear-to-r from-blue-1 to-blue-0 text-white-1';
	}
};

const iconColor = (type) => {
	switch (type) {
		case 'success':
			return 'text-white-1';
		case 'error':
			return 'text-white-1';
		case 'warning':
			return 'text-white-1';
		default:
			return 'text-white-1';
	}
};

const typeIcon = (type) => {
	switch (type) {
		case 'success':
			return 'circle-check';
		case 'error':
			return 'circle-exclamation';
		case 'warning':
			return 'warning';
		default:
			return 'circle-info';
	}
}
</script>

<style scoped>
.alert-enter-active,
.alert-leave-active {
	transition: all 0.18s ease, opacity 0.18s ease;
}

.alert-enter-from,
.alert-leave-to {
	opacity: 0;
	transform: translateY(-8px);
}
</style>
