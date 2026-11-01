//! Errors from loading game data.

use core::fmt;

/// Why game data could not be loaded.
#[derive(Debug)]
pub enum DataError {
    /// The JSON doesn't match the schema in [`crate::schema`].
    Json(serde_json::Error),
    /// The JSON's `schema` version isn't [`crate::SCHEMA_VERSION`].
    SchemaVersion {
        /// The version in the file.
        found: u32,
    },
    /// The data is well-formed but inconsistent: a broken name reference, a
    /// duplicate name, a value the TS engine's load-time asserts reject, ...
    /// The string says where and what.
    Invalid(String),
}

impl fmt::Display for DataError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DataError::Json(e) => write!(f, "game data: bad JSON: {e}"),
            DataError::SchemaVersion { found } => write!(
                f,
                "game data: schema version {found}, expected {}",
                crate::SCHEMA_VERSION
            ),
            DataError::Invalid(msg) => write!(f, "game data: {msg}"),
        }
    }
}

impl std::error::Error for DataError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            DataError::Json(e) => Some(e),
            _ => None,
        }
    }
}

impl From<serde_json::Error> for DataError {
    fn from(e: serde_json::Error) -> Self {
        DataError::Json(e)
    }
}

/// Shorthand for an [`DataError::Invalid`] result.
pub(crate) fn invalid<T>(msg: impl Into<String>) -> Result<T, DataError> {
    Err(DataError::Invalid(msg.into()))
}
