use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SslMode {
    #[default]
    Disabled,
    Preferred,
    Required,
    VerifyCa,
    VerifyIdentity,
}

const ALL_SSL_MODES: [SslMode; 5] = [
    SslMode::Disabled,
    SslMode::Preferred,
    SslMode::Required,
    SslMode::VerifyCa,
    SslMode::VerifyIdentity,
];

impl SslMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Disabled => "disabled",
            Self::Preferred => "preferred",
            Self::Required => "required",
            Self::VerifyCa => "verify_ca",
            Self::VerifyIdentity => "verify_identity",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        ALL_SSL_MODES.into_iter().find(|mode| mode.as_str() == text)
    }

    pub fn uses_tls(self) -> bool {
        self != Self::Disabled
    }
}

impl ToSql for SslMode {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(ToSqlOutput::from(self.as_str()))
    }
}

impl FromSql for SslMode {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        let text = value.as_str()?;
        Self::parse(text)
            .ok_or_else(|| FromSqlError::Other(format!("unknown SSL mode '{text}'").into()))
    }
}
