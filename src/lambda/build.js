#!/usr/bin/env node
/**
 * Build script for Lambda functions
 * 1) Compile TS/JS sources with tsc
 * 2) Bundle each function with shared dependencies into deployment packages
 */

import fs from "fs";
import path from "path";
import {execSync} from "child_process";
import {fileURLToPath} from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..", "..");
const LAMBDA_TSCONFIG = path.join(ROOT_DIR, "tsconfig.lambda.json");

const FUNCTIONS = ["instance-manager", "server-manager", "user-manager", "logs-manager", "cognito-user-link", "system-manager", "api-authorizer", "auto-shutoff-manager"];
const BUILD_DIR = path.join(__dirname, "dist");
const COMPILED_DIR = path.join(ROOT_DIR, "tsbuild", "lambda");
const WORKSPACE_DIR = path.join(ROOT_DIR, "tsbuild", "lambda-workspace");
const WORKSPACE_SRC_DIR = path.join(WORKSPACE_DIR, "src");
const WORKSPACE_TSCONFIG = path.join(WORKSPACE_DIR, "tsconfig.lambda.json");

console.log("Building Lambda functions...\n");

try {
	prepareWorkspace();

	console.log("Step 1/2: Compiling Lambda TypeScript sources...");
	if (fs.existsSync(COMPILED_DIR)) {
		fs.rmSync(COMPILED_DIR, {recursive: true});
	}

	execSync(`npx tsc -p "${WORKSPACE_TSCONFIG}"`, {
		cwd: WORKSPACE_DIR,
		stdio: "inherit",
	});

	console.log("\nStep 2/2: Packaging deployment zips...\n");

	// Clean build directory
	if (fs.existsSync(BUILD_DIR)) {
		fs.rmSync(BUILD_DIR, {recursive: true});
	}
	fs.mkdirSync(BUILD_DIR, {recursive: true});

	// Build each function
	for (const fn of FUNCTIONS) {
		console.log(`Building ${fn}...`);

		const fnSourceDir = path.join(COMPILED_DIR, fn);
		if (!fs.existsSync(fnSourceDir)) {
			throw new Error(`Missing compiled output for ${fn} at ${fnSourceDir}. Ensure tsconfig includes this directory.`);
		}

		const sharedSourceDir = path.join(COMPILED_DIR, "_shared", "shared");
		if (!fs.existsSync(sharedSourceDir)) {
			throw new Error(`Missing compiled shared output at ${sharedSourceDir}.`);
		}

			const fnPackageSourceDir = path.join(__dirname, fn);
			const sharedPackageSourceDir = path.join(__dirname, "_shared", "shared");
		const buildFnDir = path.join(BUILD_DIR, fn);

		// Create build directory for function
		fs.mkdirSync(buildFnDir, {recursive: true});

		// Copy compiled function files (exclude shared since we copy it explicitly next)
		copyRecursive(fnSourceDir, buildFnDir, ["node_modules", "package-lock.json", "shared", "tsconfig.tsbuildinfo"]);

		// Copy compiled shared utilities
		const sharedDest = path.join(buildFnDir, "shared");
		copyRecursive(sharedSourceDir, sharedDest, ["node_modules", "package-lock.json", "tsconfig.tsbuildinfo"]);

		// Merge dependencies from function and shared package.json
		const fnPackage = JSON.parse(fs.readFileSync(path.join(fnPackageSourceDir, "package.json"), "utf8"));
		const sharedPackage = JSON.parse(fs.readFileSync(path.join(sharedPackageSourceDir, "package.json"), "utf8"));

		fnPackage.dependencies = {
			...sharedPackage.dependencies,
			...fnPackage.dependencies,
		};

		fs.writeFileSync(path.join(buildFnDir, "package.json"), JSON.stringify(fnPackage, null, 2));

		// Install production dependencies
		console.log("  Installing dependencies...");
		execSync("npm install --omit=dev", {
			cwd: buildFnDir,
			stdio: "inherit",
		});

		// Create ZIP for deployment
		console.log("  Creating deployment package...");
		const zipFile = path.join(BUILD_DIR, `${fn}.zip`);

		// Use zip command
		execSync(`cd "${buildFnDir}" && zip -r "${zipFile}" .`, {stdio: "inherit"});

		console.log(`Built ${fn}: ${zipFile}\n`);
	}

	console.log("All functions built successfully!");
	console.log(`\nDeployment packages in: ${BUILD_DIR}`);
} finally {
	cleanupWorkspace();
}

/**
 * Recursively copy directory (handles symlinks correctly)
 */
function copyRecursive(src, dest, exclude = []) {
	if (!fs.existsSync(dest)) {
		fs.mkdirSync(dest, {recursive: true});
	}

	const entries = fs.readdirSync(src, {withFileTypes: true});

	for (const entry of entries) {
		if (exclude.includes(entry.name)) continue;

		const srcPath = path.join(src, entry.name);
		const destPath = path.join(dest, entry.name);

		// Resolve symlinks to their actual targets
		const stats = fs.lstatSync(srcPath);
		
		if (stats.isSymbolicLink()) {
			// Follow the symlink and copy the actual content
			const linkTarget = fs.readlinkSync(srcPath);
			const realPath = path.resolve(path.dirname(srcPath), linkTarget);
			const realStats = fs.statSync(realPath);
			
			if (realStats.isDirectory()) {
				copyRecursive(realPath, destPath, exclude);
			} else {
				fs.copyFileSync(realPath, destPath);
			}
		} else if (entry.isDirectory()) {
			copyRecursive(srcPath, destPath, exclude);
		} else {
			fs.copyFileSync(srcPath, destPath);
		}
	}
}

function prepareWorkspace() {
	if (fs.existsSync(WORKSPACE_DIR)) {
		fs.rmSync(WORKSPACE_DIR, {recursive: true, force: true});
	}

	fs.mkdirSync(WORKSPACE_SRC_DIR, {recursive: true});

	const workspaceLambdaDir = path.join(WORKSPACE_SRC_DIR, "lambda");
	const workspaceSharedTypesDir = path.join(WORKSPACE_SRC_DIR, "shared", "types");
	const workspaceSharedSourceDir = path.join(workspaceLambdaDir, "_shared", "shared");

	copyRecursive(__dirname, workspaceLambdaDir, ["dist", "node_modules", "package-lock.json", "tsconfig.tsbuildinfo"]);
	copyRecursive(path.join(ROOT_DIR, "src", "shared", "types"), workspaceSharedTypesDir, ["node_modules", "package-lock.json", "tsconfig.tsbuildinfo"]);

	const workspaceTscConfig = {
		extends: "../../tsconfig.json",
		include: ["src/lambda/**/*.ts", "src/lambda/**/*.js", "src/shared/types/**/*.ts"],
		exclude: ["**/node_modules", "**/tsbuild"],
	};

	fs.mkdirSync(workspaceSharedSourceDir, {recursive: true});
	fs.writeFileSync(WORKSPACE_TSCONFIG, JSON.stringify(workspaceTscConfig, null, 2));
}


function cleanupWorkspace() {
	if (fs.existsSync(WORKSPACE_DIR)) {
		fs.rmSync(WORKSPACE_DIR, {recursive: true, force: true});
	}
}
