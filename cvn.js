#!/usr/bin/env node

const process = require('process')
const fs = require('fs')
const cp = require('child_process')
const path = require('path')
const flags = require('commander');

function collect(value, previous) {
	if (!previous) {
		return [value]
	}
	return previous.concat([value]);
}

flags
	.version('0.1.0')
	.option('-g, --gen', 'Generate build files.')
	.option('-b, --build', 'Build binary.')
	.option('-r, --release', 'Set release mode.')
	.option('-j, --jobs <N>', '')
	.option('-c, --clean', '')
	.option('-d, --cmake-define <var>', 'Create or update a cmake cache entry.', collect)
	.option('-s, --src <path-to-source>', 'Explicitly specify a source directory.', '.')
	.option('-o, --output <path-to-output>', 'Explicitly specify a output directory.', 'out.cvn')
	.parse(process.argv)

function mkdir(dir) {
	if (fs.existsSync(dir)) {
		return false
	}
	mkdir(path.dirname(dir))
	fs.mkdirSync(dir)
	return true
}

function rm(path) {
	var files = []
	if (fs.existsSync(path)) {
		files = fs.readdirSync(path)
		files.forEach(function (file, index) {
			var curPath = path + "/" + file
			if (fs.lstatSync(curPath).isDirectory()) { // recurse
				rm(curPath)
			} else { // delete file
				fs.unlinkSync(curPath);
			}
		})
		fs.rmdirSync(path)
	}
}

async function exec(cmd, args) {
	return await new Promise((resolve) => {
		var child = cp.spawn(cmd, args, { stdio: 'inherit' });
		child.on('exit', function (code) {
			resolve(code)
		});
	})
}

async function cmake(srcDir, outDir, args) {
	mkdir(outDir)
	if (await exec('cmake', ['-S', srcDir, '-B', outDir].concat(args)) === 0) {
		console.log('')
		return true
	}
	return false
}

;
(async () => {
	const vcpkgRoot = process.env['VCPKG_ROOT']
	if (!vcpkgRoot) {
		console.error('Undefined VCPKG_ROOT!')
		return
	}

	const cmakeToolchainFile = '-DCMAKE_TOOLCHAIN_FILE=' + path.join(vcpkgRoot, 'scripts', 'buildsystems', 'vcpkg.cmake')

	const vcpkgDefaultTriplet = process.env['VCPKG_DEFAULT_TRIPLET']
	if (!vcpkgDefaultTriplet) {
		console.error('Undefined VCPKG_DEFAULT_TRIPLET!')
		return
	}

	const outDirBase = path.join(flags.output, vcpkgDefaultTriplet)
	var outDir = outDirBase
	if (!flags.release) {
		outDir += '-d'
	}

	if (flags.clean) {
		rm(flags.output)
	}

	if (flags.gen || flags.build) {
		var args = [
			cmakeToolchainFile
		]
		if (flags.cmakeDefine && flags.cmakeDefine.length > 0) {
			args = args.concat(flags.cmakeDefine)
			for (let i = args.length - flags.cmakeDefine.length; i < args.length; i++) {
				args[i] = '-D' + args[i]
			}
		}

		console.log('=> Generating build files')
		if (!fs.existsSync(outDir)) {
			if (!await cmake(
				flags.src,
				outDir,
				[
					'-G', 'Ninja',
					'-DCMAKE_BUILD_TYPE=' + (flags.release ? 'Release' : 'Debug')
				].concat(args)
			)) {
				return
			}
		} else {
			console.log('Already exists.')
			console.log('If you want to regenerate, use "-c" or "--clean" option.')
			console.log('')
		}

		if (flags.gen && process.platform === 'win32') {
			var outDir = outDirBase + '-vs'
			console.log('=> Generating Visual Studio files')
			if (!fs.existsSync(outDir)) {
				if (!await cmake(
					flags.src,
					outDir,
					args
				)) {
					return
				}
			} else {
				console.log('Already exists.')
				console.log('If you want to regenerate, use "-c" or "--clean" option.')
				console.log('')
			}
		}
	}

	if (flags.build) {
		console.log('=> Building')
		var args = ['-C', outDir]
		if (flags.jobs) {
			args.concat(['-j', flags.jobs])
		}
		if (await exec('ninja', args) !== 0) {
			return false
		}
		console.log('')
		console.log('=> Output: ' + outDir)
		console.log('')
	}
})()
