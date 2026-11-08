//! Read-only inventory. Configuration secrets and skill bodies stay in the backend.

use crate::sessions::Agent;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Scope { Global, Project }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpServer {
    name: String,
    transport: String,
    command: Option<String>,
    scope: Scope,
    source: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    name: String,
    description: String,
    path: String,
    scope: Scope,
    managed: bool,
    repository: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceError { section: &'static str, path: String, reason: String }

/// Something the page explains in its own words; `detail` fills in the specifics.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceNote { section: &'static str, kind: &'static str, detail: String }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Inventory {
    agent: Agent,
    mcp_servers: Vec<McpServer>,
    skills: Vec<Skill>,
    errors: Vec<ResourceError>,
    notes: Vec<ResourceNote>,
}

pub struct Locations {
    pub home: PathBuf,
    pub claude: PathBuf,
    pub claude_config: PathBuf,
    pub codex: PathBuf,
    pub pi: PathBuf,
    pub global_lock: PathBuf,
}

impl Locations {
    pub fn at(home: PathBuf) -> Self {
        Self { claude: home.join(".claude"), claude_config: home.join(".claude.json"), codex: home.join(".codex"), pi: home.join(".pi/agent"), global_lock: home.join(".agents/.skill-lock.json"), home }
    }

    pub fn from_environment() -> Result<Self, String> {
        let mut paths = Self::at(crate::conversations::home_dir()?);
        #[cfg(debug_assertions)]
        if let Some(path) = std::env::var_os("TANDEM_DRIVE_RESOURCE_HOME") { paths = Self::at(path.into()); }
        if let Some(path) = std::env::var_os("CLAUDE_CONFIG_DIR") { paths.claude = path.into(); paths.claude_config = paths.claude.join(".claude.json"); }
        if let Some(path) = std::env::var_os("CODEX_HOME") { paths.codex = path.into(); }
        if let Some(path) = std::env::var_os("PI_CODING_AGENT_DIR") { paths.pi = path.into(); }
        if let Some(path) = std::env::var_os("XDG_STATE_HOME").filter(|path| !path.is_empty()) { paths.global_lock = PathBuf::from(path).join("skills/.skill-lock.json"); }
        Ok(paths)
    }
}

fn optional_text(path: &Path, limit: u64) -> Result<Option<String>, String> {
    let file = match fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    if file.metadata().map_err(|error| error.to_string())?.len() > limit { return Err(format!("文件超过 {} KB", limit / 1024)); }
    let mut text = String::new();
    file.take(limit + 1).read_to_string(&mut text).map_err(|error| error.to_string())?;
    if text.len() as u64 > limit { return Err(format!("文件超过 {} KB", limit / 1024)); }
    Ok(Some(text))
}

fn json(path: &Path) -> Result<Option<Value>, String> {
    optional_text(path, 4 * 1024 * 1024)?.map(|text| serde_json::from_str(&text).map_err(|error| format!("JSON 语法错误：第 {} 行，第 {} 列", error.line(), error.column()))).transpose()
}

fn toml(path: &Path) -> Result<Option<Value>, String> {
    optional_text(path, 4 * 1024 * 1024)?.map(|text| toml_edit::de::from_str(&text).map_err(|error| format!("TOML 语法错误：字节位置 {}", error.span().map_or(0, |span| span.start)))).transpose()
}

impl Inventory {
    fn error(&mut self, section: &'static str, path: &Path, reason: String) {
        self.errors.push(ResourceError { section, path: path.to_string_lossy().into_owned(), reason });
    }

    fn read_config(&mut self, path: &Path, scope: Scope, cwd: Option<&Path>, is_toml: bool) {
        let result = if is_toml { toml(path) } else { json(path) };
        let config = match result {
            Ok(Some(value)) => value,
            Ok(None) => return,
            Err(reason) => { self.error("mcp", path, reason); return; }
        };
        let key = if is_toml { "mcp_servers" } else { "mcpServers" };
        self.servers(config.get(key), scope, path);
        if let Some(cwd) = cwd {
            self.servers(config.get("projects").and_then(|value| value.get(cwd.to_string_lossy().as_ref())).and_then(|value| value.get("mcpServers")), Scope::Project, path);
        }
    }

    /// Pi's built-in MCP reads `mcp.json`. The `pi-mcp-adapter` package, used when the built-in one
    /// is turned off, reads shared files as well; its sources and precedence follow its `config.ts` (7.0.1).
    fn read_pi_mcp(&mut self, paths: &Locations, cwd: Option<&Path>, roots: &[PathBuf]) {
        // Unreadable settings are reported once, by the skills pass that also reads them.
        let settings: Vec<Value> = std::iter::once(paths.pi.join("settings.json"))
            .chain(cwd.map(|cwd| cwd.join(".pi/settings.json")))
            .filter_map(|path| json(&path).ok().flatten())
            .collect();
        let listed = |key: &str| -> Vec<String> {
            settings.iter().filter_map(|value| value.get(key)?.as_array()).flatten()
                .filter_map(|entry| entry.as_str().or_else(|| entry.get("source")?.as_str()).map(str::to_owned))
                .collect()
        };
        let builtin = !listed("extensions").iter().any(|entry| entry == "-builtin:mcp");
        let adapter = listed("packages").iter().any(|entry| entry.contains("pi-mcp-adapter"));
        if !adapter {
            if !builtin {
                self.notes.push(ResourceNote { section: "mcp", kind: "piMcpDisabled", detail: String::new() });
                return;
            }
            self.read_config(&paths.pi.join("mcp.json"), Scope::Global, None, false);
            for root in roots { self.read_config(&root.join(".pi/mcp.json"), Scope::Project, None, false); }
            return;
        }
        let sources: Vec<(PathBuf, Scope)> = [
            paths.home.join(".config/mcp/mcp.json"),
            paths.home.join(".agents/mcp.json"),
            paths.home.join(".agents/mcp/mcp.json"),
            paths.pi.join("mcp.json"),
            paths.pi.join("mcp-adapter.json"),
        ].into_iter().map(|path| (path, Scope::Global))
            .chain(cwd.into_iter().flat_map(|cwd| [cwd.join(".mcp.json"), cwd.join(".pi/mcp.json"), cwd.join(".pi/mcp-adapter.json")]).map(|path| (path, Scope::Project)))
            .collect();
        let start = self.mcp_servers.len();
        let mut imports: Vec<String> = Vec::new();
        for (path, scope) in &sources {
            self.read_config(path, *scope, None, false);
            if let Ok(Some(config)) = json(path) {
                for kind in config.get("imports").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_str) {
                    if !imports.iter().any(|known| known == kind) { imports.push(kind.to_owned()); }
                }
            }
        }
        // A later file overrides an earlier one by server name, as the adapter merges them.
        let mut seen = HashSet::new();
        let mut kept: Vec<McpServer> = self.mcp_servers.drain(start..).rev().filter(|server| seen.insert(server.name.clone())).collect();
        kept.reverse();
        self.mcp_servers.extend(kept);
        if !imports.is_empty() {
            self.notes.push(ResourceNote { section: "mcp", kind: "mcpImports", detail: imports.join(", ") });
        }
    }

    fn servers(&mut self, value: Option<&Value>, scope: Scope, path: &Path) {
        let Some(value) = value else { return; };
        let Some(servers) = value.as_object() else { self.error("mcp", path, "MCP 服务器配置需要使用名称到配置的映射".into()); return; };
        for (name, config) in servers {
            if !config.is_object() { self.error("mcp", path, format!("MCP 服务器 {name} 的配置需要是对象")); continue; }
            let command = config.get("command").and_then(Value::as_str).map(str::to_owned);
            let transport = config.get("type").and_then(Value::as_str).unwrap_or(if command.is_some() { "stdio" } else { "http" });
            self.mcp_servers.push(McpServer { name: name.clone(), transport: transport.into(), command, scope, source: path.to_string_lossy().into_owned() });
        }
    }

    fn lock(&mut self, path: &Path) -> HashMap<String, Option<String>> {
        match json(path) {
            Ok(Some(value)) => value.get("skills").and_then(Value::as_object).map(|skills| skills.iter().map(|(name, value)| {
                (name.clone(), value.get("source").and_then(Value::as_str).map(str::to_owned))
            }).collect()).unwrap_or_default(),
            Ok(None) => HashMap::new(),
            Err(reason) => { self.error("skills", path, reason); HashMap::new() }
        }
    }
}

/// Ancestor project resources stop at the repository boundary, including worktree .git files.
fn project_roots(cwd: Option<&Path>) -> Vec<PathBuf> {
    let Some(cwd) = cwd else { return Vec::new(); };
    let mut roots = Vec::new();
    for path in cwd.ancestors() {
        roots.push(path.to_path_buf());
        if path.join(".git").exists() { break; }
    }
    roots
}

struct SkillReader<'a> {
    inventory: &'a mut Inventory,
    seen: HashSet<(Scope, PathBuf)>,
    locks: HashMap<PathBuf, HashMap<String, Option<String>>>,
}

#[derive(Deserialize)]
struct Frontmatter { name: Option<String>, description: String }

impl SkillReader<'_> {
    fn scan(&mut self, root: &Path, scope: Scope, lock: &Path, standalone: bool) {
        if !self.locks.contains_key(lock) { let entries = self.inventory.lock(lock); self.locks.insert(lock.to_path_buf(), entries); }
        let metadata = match fs::metadata(root) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
            Err(error) => { self.inventory.error("skills", root, error.to_string()); return; }
        };
        let canonical = match fs::canonicalize(root) { Ok(path) => path, Err(error) => { self.inventory.error("skills", root, error.to_string()); return; } };
        if !self.seen.insert((scope, canonical)) { return; }
        if metadata.is_file() { self.skill(root, scope, lock); return; }
        let skill_path = root.join("SKILL.md");
        if skill_path.is_file() { self.skill(&skill_path, scope, lock); return; }
        let entries = match fs::read_dir(root) { Ok(entries) => entries, Err(error) => { self.inventory.error("skills", root, error.to_string()); return; } };
        for entry in entries {
            match entry {
                Ok(entry) => {
                    let name = entry.file_name();
                    let name = name.to_string_lossy();
                    if name.starts_with('.') && name != ".system" { continue; }
                    let path = entry.path();
                    if path.is_dir() || standalone && path.extension().is_some_and(|extension| extension == "md") { self.scan(&path, scope, lock, standalone); }
                }
                Err(error) => self.inventory.error("skills", root, error.to_string()),
            }
        }
    }

    fn skill(&mut self, path: &Path, scope: Scope, lock: &Path) {
        let parsed = (|| {
            let text = optional_text(path, 1024 * 1024)?.ok_or_else(|| "技能文件已移除".to_owned())?;
            let mut lines = text.lines();
            if lines.next() != Some("---") { return Err("SKILL.md 需要 YAML front matter".into()); }
            let mut header = Vec::new();
            for line in lines {
                if line == "---" { break; }
                header.push(line);
            }
            serde_yaml_ng::from_str::<Frontmatter>(&header.join("\n")).map_err(|error| format!("技能元数据格式错误{}", error.location().map(|location| format!("：第 {} 行", location.line())).unwrap_or_default()))
        })();
        match parsed {
            Ok(metadata) => {
                let folder = if path.file_name().is_some_and(|name| name == "SKILL.md") { path.parent().and_then(Path::file_name) } else { path.file_stem() }.unwrap_or_default().to_string_lossy();
                let name = metadata.name.unwrap_or_else(|| folder.to_string());
                let source = self.locks[lock].get(&name).or_else(|| self.locks[lock].get(folder.as_ref()));
                self.inventory.skills.push(Skill { name, description: metadata.description.trim().into(), path: path.to_string_lossy().into_owned(), scope, managed: source.is_some(), repository: source.cloned().flatten() });
            }
            Err(reason) => self.inventory.error("skills", path, reason),
        }
    }
}

pub fn read(paths: &Locations, cwd: Option<&Path>) -> Vec<Inventory> {
    let roots = project_roots(cwd);
    [Agent::Claude, Agent::Codex, Agent::Pi].into_iter().map(|agent| {
        let mut inventory = Inventory { agent, mcp_servers: Vec::new(), skills: Vec::new(), errors: Vec::new(), notes: Vec::new() };
        let (global, project_dir) = match agent {
            Agent::Claude => (&paths.claude, ".claude"),
            Agent::Codex => (&paths.codex, ".codex"),
            Agent::Pi => (&paths.pi, ".pi"),
        };
        match agent {
            Agent::Claude => inventory.read_config(&paths.claude_config, Scope::Global, cwd, false),
            Agent::Codex => inventory.read_config(&global.join("config.toml"), Scope::Global, None, true),
            Agent::Pi => inventory.read_pi_mcp(paths, cwd, &roots),
        };
        for root in roots.iter().filter(|_| agent != Agent::Pi) {
            let path = if agent == Agent::Claude { root.join(".mcp.json") } else { root.join(".codex/config.toml") };
            inventory.read_config(&path, Scope::Project, None, agent == Agent::Codex);
        }
        let mut reader = SkillReader { inventory: &mut inventory, seen: HashSet::new(), locks: HashMap::new() };
        reader.scan(&global.join("skills"), Scope::Global, &paths.global_lock, agent == Agent::Pi);
        if agent != Agent::Claude { reader.scan(&paths.home.join(".agents/skills"), Scope::Global, &paths.global_lock, false); }
        for root in &roots {
            let lock = root.join("skills-lock.json");
            reader.scan(&root.join(project_dir).join("skills"), Scope::Project, &lock, agent == Agent::Pi);
            if agent != Agent::Claude { reader.scan(&root.join(".agents/skills"), Scope::Project, &lock, false); }
        }
        if agent == Agent::Pi {
            for (base, scope, lock) in std::iter::once((paths.pi.clone(), Scope::Global, paths.global_lock.clone())).chain(cwd.map(|cwd| (cwd.join(".pi"), Scope::Project, cwd.join("skills-lock.json")))) {
                let settings = base.join("settings.json");
                match json(&settings) {
                    Ok(Some(value)) => if let Some(skills) = value.get("skills").and_then(Value::as_array) {
                        for skill in skills.iter().filter_map(Value::as_str).filter(|skill| !skill.starts_with('!') && !skill.starts_with('-')) {
                            match crate::local_files::resolve(&base, &paths.home, skill.strip_prefix('+').unwrap_or(skill)) {
                                Ok(path) => reader.scan(&path, scope, &lock, true),
                                Err(reason) => reader.inventory.error("skills", &settings, reason),
                            }
                        }
                    },
                    Ok(None) => {},
                    Err(reason) => reader.inventory.error("skills", &settings, reason),
                }
            }
        }
        inventory.skills.sort_by(|a, b| a.name.cmp(&b.name).then(a.path.cmp(&b.path)));
        inventory
    }).collect()
}

#[cfg(test)]
mod tests;
