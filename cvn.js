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

function rm(p) {
	if (!fs.existsSync(p)) {
		return
	}
	if (!fs.lstatSync(p).isDirectory()) {
		fs.unlinkSync(p)
		return
	}
	fs.readdirSync(p).forEach(function (n) {
		rm(path.join(p, n))
	})
	fs.rmdirSync(p)
}

function clean(p) {
	if (!fs.existsSync(p)) {
		return
	}
	if (!fs.lstatSync(p).isDirectory()) {
		return
	}
	fs.readdirSync(p).forEach(function (n) {
		rm(path.join(p, n))
	})
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

function getArch(target) {
	const pos = target.indexOf('-')
	if (pos >= 0) {
		return target.substring(0, pos).toLowerCase()
	}
	return target.toLowerCase()
}

;
(async () => {
	var target, vcpkgRoot

	target = process.env['MINGW_CHOST']
	if (!target) {
		vcpkgRoot = process.env['VCPKG_ROOT']
		if (vcpkgRoot) {
			target = process.env['VCPKG_DEFAULT_TRIPLET']
		} else {
			target = 'native'
		}
	}

	const outDirBase = path.join(flags.output, target)
	var outDir = outDirBase
	if (!flags.release) {
		outDir += '-d'
	}

	if (flags.clean) {
		clean(outDir)
	}

	if (flags.gen || flags.build) {
		var args = vcpkgRoot ? [
			'-DCMAKE_TOOLCHAIN_FILE=' + path.join(vcpkgRoot, 'scripts', 'buildsystems', 'vcpkg.cmake'),
			'-DVCPKG_TARGET_TRIPLET=' + target
		] : []
		if (flags.cmakeDefine && flags.cmakeDefine.length > 0) {
			args = args.concat(flags.cmakeDefine)
			for (let i = args.length - flags.cmakeDefine.length; i < args.length; i++) {
				args[i] = '-D' + args[i]
			}
		}

		console.log('=> Generating build files')
		if (!fs.existsSync(path.join(outDir, 'build.ninja'))) {
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
			console.log('Already exists. (use "-c" or "--clean" to regenerate)')
			console.log('')
		}

		if (flags.gen && process.platform === 'win32') {
			var vsArch
			if (target !== 'native') {
				switch (getArch(target)) {
					case 'amd64':
					case 'x86_64':
					case 'x64':
						vsArch = 'x64'
						break
					case 'i386':
					case 'i686':
					case 'x86':
						vsArch = 'Win32'
				}
			}
			var vsTarget
			if (vsArch) {
				vsTarget = vsArch + '-windows-vs'
			} else {
				vsTarget = 'native-windows-vs'
			}
			const outDir = path.join(flags.output, vsTarget)
			if (flags.clean) {
				clean(outDir)
			}
			console.log('=> Generating Visual Studio files')
			if (!fs.existsSync(path.join(outDir, 'CMakeCache.txt'))) {
				if (!await cmake(
					flags.src,
					outDir,
					vsArch ? ['-A', vsArch].concat(args) : args
				)) {
					return
				}
			} else {
				console.log('Already exists. (use "-c" or "--clean" to regenerate)')
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
			return
		}
		console.log('')
		console.log('=> Output: ' + outDir)
		console.log('')
	}
})()
