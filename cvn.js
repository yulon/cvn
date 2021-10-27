#!/usr/bin/env node

const process = require('process')
const fs = require('fs')
const cp = require('child_process')
const path = require('path')
const { program } = require('commander');

var buildTarget

program
	.version('0.4.0')
	.option('-g, --gen', 'Generate build files.')
	.option('-b, --build', 'Build binary.')
	.option('-r, --release', 'Set release mode.')
	.option('-i, --ide', 'Generate IDE files.')
	.option('-x, --winxp', 'Use Windows XP compatible toolset.')
	.option('-j, --jobs <N>', '')
	.option('-c, --clean', '')
	.option('-d, --cmake-define <defines...>', 'Create or update a cmake cache entry.')
	.option('-s, --src <path-to-source>', 'Explicitly specify a source directory.', '.')
	.option('-o, --output <path-to-output>', 'Explicitly specify a output directory.', 'out.cvn')
	.argument('[target]', 'Build target name.')
	.action((target) => {
		buildTarget = target
	})
	.parse(process.argv)

const flags = program.opts()

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

async function cmakeConfigure(srcDir, outDir, args) {
	mkdir(outDir)
	if (await exec('cmake', ['-S', srcDir, '-B', outDir].concat(args)) === 0) {
		console.log('')
		return true
	}
	return false
}

async function cmakeBuild(outDir, args) {
	if (await exec('cmake', ['--build', outDir].concat(args)) === 0) {
		return true
	}
	return false
}

function getArch(plat) {
	const pos = plat.indexOf('-')
	if (pos >= 0) {
		return plat.substring(0, pos).toLowerCase()
	}
	return plat.toLowerCase()
}

;
(async () => {
	var plat, vcpkgRoot

	plat = process.env['MINGW_CHOST']
	if (!plat) {
		vcpkgRoot = process.env['VCPKG_ROOT']
		if (vcpkgRoot) {
			plat = process.env['VCPKG_DEFAULT_TRIPLET']
		} else {
			plat = 'native'
		}
	}

	const outDirBase = path.join(flags.output, plat)
	var outDir = outDirBase
	if (!flags.release) {
		outDir += '-d'
	}

	if (flags.gen || flags.build) {
		var args = vcpkgRoot ? [
			'-DCMAKE_TOOLCHAIN_FILE=' + path.join(vcpkgRoot, 'scripts', 'buildsystems', 'vcpkg.cmake'),
			'-DVCPKG_TARGET_TRIPLET=' + plat
		] : []
		if (flags.cmakeDefine && flags.cmakeDefine.length > 0) {
			args.push(...flags.cmakeDefine)
			for (let i = args.length - flags.cmakeDefine.length; i < args.length; i++) {
				args[i] = '-D' + args[i]
			}
		}
		if (flags.ide && process.platform === 'win32') {
			console.log('=> Generating Visual Studio files')

			var vsArch = 'native'
			if (plat !== 'native') {
				switch (getArch(plat)) {
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
			outDir = path.join(flags.output, vsTarget)
			if (flags.clean) {
				clean(outDir)
			}
			if (!fs.existsSync(path.join(outDir, 'CMakeCache.txt'))) {
				if (vsArch !== 'native') {
					args = ['-A', vsArch].concat(args)
				}
				if (flags.winxp) {
					args = ['-T', 'v141_xp'].concat(args)
				}
				if (!await cmakeConfigure(flags.src, outDir, args)) {
					return
				}
			} else {
				console.log('Already exists. (use "-c" or "--clean" to regenerate)')
				console.log('')
			}
		} else {
			console.log('=> Generating build files')

			if (flags.clean) {
				clean(outDir)
			}
			args = [
				'-G', 'Ninja',
				'-DCMAKE_BUILD_TYPE=' + (flags.release ? 'Release' : 'Debug')
			].concat(args)
			if (!fs.existsSync(path.join(outDir, 'build.ninja'))) {
				if (!await cmakeConfigure(flags.src, outDir, args)) {
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

		var args = []
		if (flags.ide) {
			args.push(...['--config', (flags.release ? 'Release' : 'Debug')])
		}
		if (flags.jobs) {
			args.push(...['-j', flags.jobs])
		}
		if (buildTarget) {
			args.push(...['--target', buildTarget])
		}
		await cmakeBuild(outDir, args)
	}
})()
