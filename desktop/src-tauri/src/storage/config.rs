use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use toml_edit::{DocumentMut, Item};

pub const TEMPLATE: &str = r#"# Tandem 用户配置。保存后自动生效；CLI 的配置仍由各 CLI 管理。
# theme: system / light / dark；language: system / zh / en
theme = "system"
light_theme = "tandem-light"
dark_theme = "tandem-dark"
language = "system"
ui_font_size = 14
send_with_cmd_enter = false
translucent_sidebar = true
keep_in_menu_bar = true
notify_when_done = true

# 自动检查并下载更新；安装和重启始终由用户确认。间隔可选 1 / 6 / 12 / 24 小时。
auto_update = false
update_check_interval_hours = 6

# 在 ~/.tandem/logs/ 记录运行细节，方便反馈问题；错误始终记录。日志只在本机，不记录对话内容。
debug_log = false

# 空字符串表示 ~/.tandem/conversations；旧目录中的任务继续可见。
conversation_dir = ""
past_conversation_dirs = []
projects = []
new_task_agent = "claude"

# 项目下按 CLI 分组；任务排序：time（最近活动）/ type（CLI 类型）/ priority（等你回答 > 完成未读 > 运行中 > 其他）。
sidebar_group_by_cli = false
sidebar_sort = "time"
# 不在任务列表里显示的 CLI（claude / codex / pi）：不扫描它们的会话，登录状态、MCP 和 Skills 照常显示。
hidden_task_agents = []

# model、effort 留空时跟随 CLI；权限选项只通过启动参数传递。
[agents.claude]
model = ""
effort = ""
permission_mode = "ask"

[agents.codex]
model = ""
effort = ""
permission_mode = "ask"

[agents.pi]
model = ""
effort = ""
permission_mode = "ask"
"#;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct TurnPrefs {
    pub model: String,
    pub effort: String,
    pub permission_mode: String,
}

impl Default for TurnPrefs {
    fn default() -> Self {
        Self {
            model: String::new(),
            effort: String::new(),
            permission_mode: "ask".into(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct Agents {
    pub claude: TurnPrefs,
    pub codex: TurnPrefs,
    pub pi: TurnPrefs,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct Config {
    pub theme: String,
    pub light_theme: String,
    pub dark_theme: String,
    pub language: String,
    pub ui_font_size: u8,
    pub send_with_cmd_enter: bool,
    pub translucent_sidebar: bool,
    pub keep_in_menu_bar: bool,
    pub notify_when_done: bool,
    pub auto_update: bool,
    pub update_check_interval_hours: u8,
    pub debug_log: bool,
    pub conversation_dir: String,
    pub past_conversation_dirs: Vec<String>,
    pub projects: Vec<String>,
    pub new_task_agent: String,
    pub sidebar_group_by_cli: bool,
    pub sidebar_sort: String,
    pub hidden_task_agents: Vec<String>,
    pub agents: Agents,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            light_theme: "tandem-light".into(),
            dark_theme: "tandem-dark".into(),
            language: "system".into(),
            ui_font_size: 14,
            send_with_cmd_enter: false,
            translucent_sidebar: true,
            keep_in_menu_bar: true,
            notify_when_done: true,
            auto_update: false,
            update_check_interval_hours: 6,
            debug_log: false,
            conversation_dir: String::new(),
            past_conversation_dirs: Vec::new(),
            projects: Vec::new(),
            new_task_agent: "claude".into(),
            sidebar_group_by_cli: false,
            sidebar_sort: "time".into(),
            hidden_task_agents: Vec::new(),
            agents: Agents::default(),
        }
    }
}

impl Config {
    pub fn validate(&self) -> Result<(), String> {
        if !["system", "light", "dark"].contains(&self.theme.as_str()) {
            return Err("theme 使用 system、light 或 dark".into());
        }
        if !["system", "zh", "en"].contains(&self.language.as_str()) {
            return Err("language 使用 system、zh 或 en".into());
        }
        if ![1, 6, 12, 24].contains(&self.update_check_interval_hours) {
            return Err("update_check_interval_hours 使用 1、6、12 或 24 小时".into());
        }
        if !(12..=18).contains(&self.ui_font_size) {
            return Err("ui_font_size 范围为 12–18".into());
        }
        if ![
            "tandem-light",
            "default-light",
            "atom-one-light",
            "solarized-light",
        ]
        .contains(&self.light_theme.as_str())
        {
            return Err("light_theme 需要选择已提供的浅色主题".into());
        }
        if ![
            "tandem-dark",
            "default-dark",
            "one-dark-pro",
            "github-dark",
            "monokai-pro",
            "eclipse",
            "material-ocean",
        ]
        .contains(&self.dark_theme.as_str())
        {
            return Err("dark_theme 需要选择已提供的深色主题".into());
        }
        if !["claude", "codex", "pi"].contains(&self.new_task_agent.as_str()) {
            return Err("new_task_agent 使用 claude、codex 或 pi".into());
        }
        if !["time", "type", "priority"].contains(&self.sidebar_sort.as_str()) {
            return Err("sidebar_sort 使用 time、type 或 priority".into());
        }
        if self.hidden_task_agents.iter().any(|agent| !["claude", "codex", "pi"].contains(&agent.as_str())) {
            return Err("hidden_task_agents 只能包含 claude、codex 或 pi".into());
        }
        for path in self
            .projects
            .iter()
            .chain(&self.past_conversation_dirs)
            .chain(std::iter::once(&self.conversation_dir))
            .filter(|path| !path.is_empty())
        {
            if !std::path::Path::new(path).is_absolute() {
                return Err("项目和对话目录使用绝对路径".into());
            }
        }
        for prefs in [&self.agents.claude, &self.agents.codex, &self.agents.pi] {
            if !["ask", "acceptEdits", "auto", "bypassPermissions"]
                .contains(&prefs.permission_mode.as_str())
            {
                return Err(
                    "permission_mode 使用 ask、acceptEdits、auto 或 bypassPermissions".into(),
                );
            }
        }
        Ok(())
    }
}

pub fn parse(text: &str) -> Result<(DocumentMut, Config), String> {
    let document: DocumentMut = text
        .parse()
        .map_err(|error| format!("config.toml 语法错误：{error}"))?;
    let config: Config = toml_edit::de::from_document(document.clone())
        .map_err(|error| format!("config.toml 配置错误：{error}"))?;
    config.validate()?;
    Ok((document, config))
}

/// Derive field names from the serialized schema, keeping TOML-only unknown fields intact.
pub fn warnings(document: &DocumentMut) -> Vec<String> {
    fn collect(item: &Item, schema: &Value, prefix: &str, fields: &mut Vec<String>) {
        if let (Some(table), Some(known)) = (item.as_table_like(), schema.as_object()) {
            for (key, value) in table.iter() {
                let path = if prefix.is_empty() {
                    key.to_owned()
                } else {
                    format!("{prefix}.{key}")
                };
                match known.get(key) {
                    Some(schema) => collect(value, schema, &path, fields),
                    None => fields.push(path),
                }
            }
        }
    }
    let schema = serde_json::to_value(Config::default()).expect("config serializes");
    let mut fields = Vec::new();
    collect(document.as_item(), &schema, "", &mut fields);
    if fields.is_empty() {
        Vec::new()
    } else {
        vec![format!("config.toml 未知字段已忽略：{}", fields.join("、"))]
    }
}

/// The patch only contains changed leaves. Rereading the file before this preserves manual edits
/// made since the last watcher tick; changing a value also preserves its inline comment.
pub fn patch(document: &mut DocumentMut, changes: &Map<String, Value>) -> Result<Config, String> {
    let (_, current) = parse(&document.to_string())?;
    let mut merged = serde_json::to_value(current).expect("config serializes");
    merge(&mut merged, &Value::Object(changes.clone()));
    let config: Config = serde_json::from_value(merged).map_err(|error| error.to_string())?;
    config.validate()?;
    let replacement = toml_edit::ser::to_document(&config).map_err(|error| error.to_string())?;
    replace_leaves(
        document.as_item_mut(),
        replacement.as_item(),
        &Value::Object(changes.clone()),
    )?;
    Ok(config)
}

pub fn merge(current: &mut Value, patch: &Value) {
    match (current, patch) {
        (Value::Object(current), Value::Object(patch)) => {
            for (key, value) in patch {
                if value.is_null() {
                    current.remove(key);
                } else {
                    merge(current.entry(key).or_insert(Value::Null), value);
                }
            }
        }
        (current, patch) => *current = patch.clone(),
    }
}

fn replace_leaves(current: &mut Item, replacement: &Item, patch: &Value) -> Result<(), String> {
    if let Value::Object(fields) = patch {
        for (key, value) in fields {
            let next = replacement
                .as_table_like()
                .and_then(|table| table.get(key))
                .ok_or_else(|| format!("设置字段不存在：{key}"))?;
            replace_leaves(&mut current[key], next, value)?;
        }
    } else {
        let mut value = replacement.clone();
        if let (Some(old), Some(new)) = (current.as_value(), value.as_value_mut()) {
            if let (Some(old), Some(new)) = (old.as_array(), new.as_array_mut()) {
                preserve_path_comments(old, new);
            }
            *new.decor_mut() = old.decor().clone();
        }
        *current = value;
    }
    Ok(())
}

/// Keep the formatting of retained paths. Comments attached to a removed path become
/// standalone comments at the end of the array, where users can keep or edit them.
fn preserve_path_comments(old: &toml_edit::Array, new: &mut toml_edit::Array) {
    let mut previous: Vec<_> = old.iter().cloned().map(Some).collect();
    for value in new.iter_mut() {
        let matching = previous.iter().position(|old| {
            old.as_ref()
                .is_some_and(|old| old.as_str() == value.as_str())
        });
        if let Some(index) = matching {
            *value = previous[index].take().expect("matched array value");
        }
    }
    let mut comments = String::new();
    for value in previous.into_iter().flatten() {
        for text in [value.decor().prefix(), value.decor().suffix()]
            .into_iter()
            .flatten()
            .filter_map(|text| text.as_str())
            .filter(|text| text.contains('#'))
        {
            comments.push_str(text);
            comments.push('\n');
        }
    }
    if !comments.is_empty() {
        comments.insert(0, '\n');
    }
    comments.push_str(old.trailing().as_str().unwrap_or_default());
    new.set_trailing(comments);
    new.set_trailing_comma(old.trailing_comma());
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn automatic_update_defaults_validation_and_hand_edits_share_one_schema() {
        let (_, defaults) = parse("theme = 'dark'").unwrap();
        assert!(!defaults.auto_update);
        assert_eq!(defaults.update_check_interval_hours, 6);
        for hours in [1, 6, 12, 24] {
            let (mut doc, _) = parse("# 用户注释\ntheme = 'dark'").unwrap();
            let config = patch(&mut doc, json!({"auto_update":true, "update_check_interval_hours":hours}).as_object().unwrap()).unwrap();
            assert!(config.auto_update);
            assert_eq!(config.update_check_interval_hours, hours);
            assert!(doc.to_string().contains("# 用户注释"));
            assert_eq!(parse(&doc.to_string()).unwrap().1, config);
        }
        for source in ["update_check_interval_hours = 0", "update_check_interval_hours = 2", "update_check_interval_hours = 25",
            "update_check_interval_hours = '6'", "auto_update = 'yes'"] {
            assert!(parse(source).is_err(), "{source}");
        }
    }

    #[test]
    fn debug_log_defaults_off_and_rejects_non_boolean_hand_edits() {
        let (mut doc, template) = parse(TEMPLATE).unwrap();
        assert!(!template.debug_log);
        assert!(!parse("theme = 'dark'").unwrap().1.debug_log);
        let config = patch(&mut doc, json!({"debug_log": true}).as_object().unwrap()).unwrap();
        assert!(config.debug_log);
        assert!(doc.to_string().contains("# 在 ~/.tandem/logs/"));
        assert!(parse("debug_log = 'on'").is_err());
    }

    #[test]
    fn changes_keep_comments_order_and_unrelated_manual_settings() {
        let source = "# 我的界面\ntheme = 'dark' # 晚上用\nui_font_size = 16\n\n[agents.codex] # 工作模型\nmodel = 'my-model' # 我的选择\n";
        let (mut doc, _) = parse(source).unwrap();
        let config = patch(
            &mut doc,
            json!({"theme":"light", "agents":{"codex":{"model":""}}})
                .as_object()
                .unwrap(),
        )
        .unwrap();
        assert_eq!(config.ui_font_size, 16);
        let text = doc.to_string();
        for comment in ["# 我的界面", "# 晚上用", "# 工作模型", "# 我的选择"] {
            assert!(text.contains(comment), "{text}");
        }
        assert!(text.contains("ui_font_size = 16"));
        assert_eq!(parse(&text).unwrap().1, config);
    }

    #[test]
    fn syntax_types_and_invalid_values_are_rejected() {
        for source in [
            "theme = 'broken'",
            "ui_font_size = 'large'",
            "ui_font_size = 100",
            "projects = ['relative']",
            "hidden_task_agents = ['cursor']",
            "theme = [",
        ] {
            assert!(parse(source).is_err(), "{source}");
        }
        let (mut doc, _) = parse(TEMPLATE).unwrap();
        assert!(patch(&mut doc, json!({"typo":true}).as_object().unwrap()).is_err());
    }

    #[test]
    fn editing_project_paths_keeps_comments_inside_the_array() {
        let source =
            "projects = [\n  # 项目说明\n  '/old', # 旧项目\n  '/keep', # 保留项目\n] # 列表注释\n";
        let (mut doc, _) = parse(source).unwrap();
        let config = patch(
            &mut doc,
            json!({"projects":["/keep", "/new"]}).as_object().unwrap(),
        )
        .unwrap();
        let text = doc.to_string();
        for comment in ["# 项目说明", "# 旧项目", "# 保留项目", "# 列表注释"] {
            assert!(text.contains(comment), "{text}");
        }
        assert_eq!(parse(&text).unwrap().1, config);
    }
}
