/**
 * Desktop notifications and the alert sound for item-rule violations.
 *
 * Deliberately not routed through `$alert`: those are page-local and errors among them are sticky by
 * design, which is the wrong shape for "someone joined with a banned item on a server you're
 * watching". This is the browser's own notification surface plus a sound, both strictly opt-in.
 *
 * Opt-in is per browser, in localStorage, because the OS-level notification permission is per device
 * anyway — storing the preference on the user's account would let the two disagree, showing a
 * switched-on toggle on a machine that will never display anything.
 */

const STORAGE_KEY = "tte.notifications.violations";

/**
 * The sound, in one place.
 *
 * A synthesized tone rather than an audio file: nothing to bundle, nothing to publish, and no
 * request that can fail. Swapping in a real sound later means changing this function and nothing
 * else — the part that actually constrains the design is `primeAudio` below, which is identical
 * either way. Prefer a bundled asset over a CDN one when that happens; the sprite atlas is the
 * cautionary tale for fetching media from another origin.
 */
function playTone(context) {
	const now = context.currentTime;
	const oscillator = context.createOscillator();
	const gain = context.createGain();

	oscillator.type = "triangle";
	// Two quick descending notes — distinct from a system chime, and short enough not to be a nuisance
	// on a busy server.
	oscillator.frequency.setValueAtTime(880, now);
	oscillator.frequency.setValueAtTime(660, now + 0.12);

	gain.gain.setValueAtTime(0.0001, now);
	gain.gain.exponentialRampToValueAtTime(0.25, now + 0.02);
	gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);

	oscillator.connect(gain);
	gain.connect(context.destination);
	oscillator.start(now);
	oscillator.stop(now + 0.36);
}

let audioContext = null;

/**
 * Creates the AudioContext. **Must be called from a user gesture handler.**
 *
 * Browsers start an AudioContext created outside a gesture in the `suspended` state, and it stays
 * that way until one happens — so a context built lazily at notification time produces silence, with
 * no error and nothing in the console. Building it on the opt-in click is what makes the toggle
 * meaningful: agreeing to notifications is the gesture that licenses the sound.
 */
export function primeAudio() {
	if (audioContext) {
		if (audioContext.state === "suspended") audioContext.resume();
		return audioContext;
	}

	const Ctor = window.AudioContext || window.webkitAudioContext;
	if (!Ctor) return null;

	audioContext = new Ctor();
	return audioContext;
}

export function playViolationSound() {
	try {
		const context = primeAudio();
		if (!context || context.state === "suspended") return;
		playTone(context);
	} catch (error) {
		// A blocked or unsupported AudioContext is not worth telling anyone about — the desktop
		// notification and the inline flag both still work.
		console.warn("[notify] could not play sound:", error?.message || error);
	}
}

export function notificationsSupported() {
	return typeof window !== "undefined" && "Notification" in window;
}

/** Whether the user has opted in *in this browser*. Independent of the OS permission. */
export function notificationsEnabled() {
	try {
		return localStorage.getItem(STORAGE_KEY) === "true";
	} catch {
		// Private modes and blocked storage throw rather than returning null.
		return false;
	}
}

export function setNotificationsEnabled(enabled) {
	try {
		localStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
	} catch {
		// Nothing to do; the toggle simply won't persist across reloads.
	}
}

export function notificationPermission() {
	return notificationsSupported() ? Notification.permission : "unsupported";
}

/**
 * Turns notifications on, asking the browser for permission if it hasn't been decided.
 *
 * Call this from a click handler: `requestPermission` requires a user gesture in most browsers, and
 * so does priming the audio. Returns the resulting permission so the caller can explain a denial
 * rather than silently leaving a switch on that does nothing.
 */
export async function enableNotifications() {
	primeAudio();

	if (!notificationsSupported()) {
		setNotificationsEnabled(true);
		return "unsupported";
	}

	let permission = Notification.permission;
	if (permission === "default") {
		permission = await Notification.requestPermission();
	}

	setNotificationsEnabled(true);
	return permission;
}

export function disableNotifications() {
	setNotificationsEnabled(false);
}

/**
 * Announces a violation: sound first, then the desktop notification.
 *
 * `tag` collapses repeats for the same player rather than stacking one notification per rescan, in
 * the same spirit as the alert store collapsing identical messages.
 */
export function notifyViolation({ title, body, tag }) {
	if (!notificationsEnabled()) return;

	playViolationSound();

	if (!notificationsSupported() || Notification.permission !== "granted") return;

	try {
		new Notification(title, {
			body,
			...(tag ? { tag } : {}),
		});
	} catch (error) {
		console.warn("[notify] could not raise notification:", error?.message || error);
	}
}
