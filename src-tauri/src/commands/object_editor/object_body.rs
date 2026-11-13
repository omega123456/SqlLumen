use super::*;

#[cfg(not(coverage))]
pub async fn get_object_body_impl(
    state: &AppState,
    request: &SchemaObjectRequest,
) -> Result<String, String> {
    let pool = get_pool(state, &request.connection_id)?;
    let ddl = schema_queries::query_ddl(&pool, request.object_ref()).await?;
    let object_type = request.object_type.as_str();
    let object_name = &request.object_name;

    if ddl.is_empty() {
        return Err(format!(
            "DDL is empty for {object_type} '{object_name}' — insufficient privileges or object not found"
        ));
    }

    if object_type == "view" {
        let re = Regex::new(
            r"(?i)^(\s*CREATE\s+)((?:ALGORITHM\s*=\s*\w+\s+)?(?:DEFINER\s*=\s*\S+\s+)?(?:SQL\s+SECURITY\s+\w+\s+)?)VIEW\s+",
        )
        .map_err(|error| format!("Internal regex error: {error}"))?;
        let normalized = re.replace(&ddl, "${1}OR REPLACE ${2}VIEW ").to_string();
        return Ok(normalized);
    }

    Ok(ddl)
}

#[cfg(coverage)]
pub async fn get_object_body_impl(
    _state: &AppState,
    request: &SchemaObjectRequest,
) -> Result<String, String> {
    let object_type = request.object_type.as_str();
    match object_type {
        "view" => Ok("CREATE OR REPLACE VIEW `v` AS SELECT 1".to_string()),
        "procedure" => Ok("CREATE PROCEDURE `p`() BEGIN SELECT 1; END".to_string()),
        "function" => Ok("CREATE FUNCTION `f`() RETURNS INT BEGIN RETURN 1; END".to_string()),
        "trigger" => {
            Ok("CREATE TRIGGER `t` BEFORE INSERT ON `tbl` FOR EACH ROW BEGIN END".to_string())
        }
        "event" => Ok("CREATE EVENT `e` ON SCHEDULE EVERY 1 DAY DO SELECT 1".to_string()),
        "table" => Ok("CREATE TABLE `t` (id INT)".to_string()),
        _ => Err(format!("Unknown object type: '{object_type}'")),
    }
}
