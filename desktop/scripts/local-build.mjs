import { spawnSync } from 'node:child_process';

/** Local artifacts identify the exact checkout without changing the release version. */
export function localBuildIdentity(cwd) {
  const git = (args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (result.status !== 0) throw new Error('本机安装需要有效的 Git 工作区和已提交版本');
    return result.stdout.trim();
  };
  const commit = git(['rev-parse', '--verify', 'HEAD']);
  if (!/^[a-f0-9]{40}$/i.test(commit)) throw new Error('Git 没有返回有效的 commit');
  return { commit, dirty: Boolean(git(['status', '--porcelain=v1', '--untracked-files=normal'])) };
}

export function localBuildPlist({ commit, dirty }) {
  if (!/^[a-f0-9]{40}$/i.test(commit) || typeof dirty !== 'boolean') throw new Error('本机构建标识无效');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>TandemBuildCommit</key><string>${commit}</string>
<key>TandemLocalBuild</key><true/>
<key>TandemBuildDirty</key><${dirty ? 'true' : 'false'}/>
</dict></plist>
`;
}
