#[cfg(test)]
mod tests {
    use super::super::*;

    fn dialogs(multi: bool, comment: bool) -> DialogReplies {
        let mut dialogs = DialogReplies::default();
        dialogs.observe(&json!({"type":"tool_execution_start", "toolCallId":"ask", "toolName":"ask_user", "args":{
            "question":"下一步？", "context":"当前背景", "options":[{"title":"A", "description":"详细说明"}, {"title":"B"}],
            "allowMultiple":multi, "allowComment":comment
        }}), false);
        dialogs
    }

    #[test]
    fn enriched_options_preserve_descriptions_native_keys_and_comment_capability() {
        let dialogs = dialogs(false, true);
        let title = "下一步？\n\nContext:\n当前背景";
        let (_, event, pending) = dialogs.present(&json!({"id":"s", "method":"select", "title":title, "options":["A","B",ASK_USER_CUSTOM_OPTION]})).unwrap();
        let TurnEvent::Question { questions, .. } = event else { panic!("question expected") };
        assert_eq!(questions[0]["question"], title);
        assert_eq!(questions[0]["displayQuestion"], "下一步？");
        assert_eq!(questions[0]["options"][0]["description"], "详细说明");
        assert_eq!(questions[0]["allowComment"], true);
        assert_eq!(pending.input["allowComment"], true);
    }

    #[test]
    fn optional_note_is_consumed_once_after_choice_and_may_be_empty() {
        for note in [Some("备注".to_owned()), Some(String::new()), None] {
            let mut dialogs = dialogs(false, true);
            let title = "下一步？\n\nContext:\n当前背景";
            let (_, _, pending) = dialogs.present(&json!({"id":"s", "method":"select", "title":title, "options":["A","B",ASK_USER_CUSTOM_OPTION]})).unwrap();
            let decision = Decision::Answer { answers: [(title.to_owned(),json!("A"))].into_iter().collect(), custom:false, comment:note.clone() };
            let command = ui_reply("s", &pending, "select", &decision).unwrap();
            let wire: Value = serde_json::from_str(&dialogs.outbound(&command).unwrap()).unwrap();
            assert_eq!(wire["value"], "A");
            let follow = json!({"id":"note","method":"input","title":format!("{title}\n\nSelected option:\n- A"),"placeholder":COMMENT_PLACEHOLDER});
            assert!(dialogs.follow_up(&json!({"id":"wrong","method":"input","title":"其他问题","placeholder":COMMENT_PLACEHOLDER})).is_none());
            let reply: Value = serde_json::from_str(&dialogs.follow_up(&follow).unwrap()).unwrap();
            assert_eq!(reply["value"], note.unwrap_or_default());
            assert!(dialogs.follow_up(&follow).is_none());
        }
    }

    #[test]
    fn multiple_choices_share_the_same_card_and_native_comment_bridge() {
        let mut dialogs = dialogs(true, true);
        let prompt = "下一步？\n\nContext:\n当前背景";
        let title = format!("{prompt}\n\nOptions (select one or more):\n1. A — 详细说明\n2. B");
        let (_, event, pending) = dialogs.present(&json!({"id":"s", "method":"input", "title":title, "placeholder":"Type your selection(s)..."})).unwrap();
        let TurnEvent::Question { questions, .. } = event else { panic!("question expected") };
        assert_eq!(questions[0]["multiSelect"], true);
        assert_eq!(questions[0]["options"].as_array().unwrap().len(), 2);
        let command = ui_reply("s", &pending, "input", &Decision::Answer { answers:[(title,json!("A, B"))].into_iter().collect(), custom:false, comment:Some("两个都要".into()) }).unwrap();
        dialogs.outbound(&command).unwrap();
        let follow = json!({"id":"c","method":"input","title":format!("{prompt}\n\nSelected options:\n- A\n- B"),"placeholder":COMMENT_PLACEHOLDER});
        let reply: Value = serde_json::from_str(&dialogs.follow_up(&follow).unwrap()).unwrap();
        assert_eq!(reply["value"], "两个都要");
    }

    #[test]
    fn ordinary_dialogs_stay_native_and_tool_end_clears_unconsumed_notes() {
        let mut dialogs = dialogs(false, true);
        let (_, event, _) = dialogs.present(&json!({"id":"x","method":"select","title":"别的扩展","options":["X"]})).unwrap();
        let TurnEvent::Question { questions, .. } = event else { panic!("question expected") };
        assert!(questions[0].get("allowComment").is_none());
        dialogs.comments.insert("old".into(), "note".into());
        dialogs.observe(&json!({"type":"tool_execution_end","toolCallId":"other"}),false);
        assert!(!dialogs.comments.is_empty());
        dialogs.observe(&json!({"type":"tool_execution_end","toolCallId":"ask"}),false);
        assert!(dialogs.comments.is_empty());
        assert!(dialogs.active.is_empty());
    }

    #[tokio::test]
    async fn configured_comment_default_is_read_from_the_child_environment_without_writing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ask-user.json");
        fs::write(&path, r#"{"allowComment":true}"#).unwrap();
        let mut env = HashMap::from([("PI_CODING_AGENT_DIR".to_owned(),dir.path().to_string_lossy().into_owned())]);
        assert!(comment_default(&env).await);
        env.insert("PI_ASK_USER_ALLOW_COMMENT".into(),"off".into());
        assert!(!comment_default(&env).await);
        assert_eq!(fs::read_to_string(&path).unwrap(), r#"{"allowComment":true}"#);
    }

    #[test]
    fn recorded_and_live_ask_results_preserve_structured_answers() {
        let details = json!({"question":"选择？","response":{"kind":"selection","selections":["A"],"comment":"备注"},"cancelled":false});
        let result = json!({"content":[{"type":"text","text":"User answered: A — 备注"}],"details":details});
        assert_eq!(result_text(&result,Some("ask_user")), details.to_string());
        assert_eq!(result_text(&result,Some("other")), "User answered: A — 备注");
        let entry = json!({"type":"message","id":"r","message":{"role":"toolResult","toolCallId":"ask","toolName":"ask_user","content":result["content"],"details":details}});
        assert_eq!(entry_messages(&entry)[0].text, details.to_string());
        let events = stream_events(&json!({"type":"tool_execution_end","toolCallId":"ask","toolName":"ask_user","result":result,"isError":false}), &mut TurnState::default());
        let TurnEvent::ToolResult { text, .. } = &events[0] else { panic!("tool result expected") };
        assert_eq!(*text, details.to_string());
        assert_eq!(result_text(&json!({"details":null,"content":[{"type":"text","text":"User answered: A"}]}),Some("ask_user")), "User answered: A");
    }
}
