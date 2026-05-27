#include "sqlite3ext.h"

SQLITE_EXTENSION_INIT1

static int metidos_ascii_lower(int ch) {
  if (ch >= 'A' && ch <= 'Z') {
    return ch + ('a' - 'A');
  }
  return ch;
}

static int metidos_ascii_equals_ignore_case(const char *left, const char *right) {
  if (left == 0 || right == 0) {
    return 0;
  }

  while (*left != '\0' && *right != '\0') {
    if (metidos_ascii_lower((unsigned char)*left) !=
        metidos_ascii_lower((unsigned char)*right)) {
      return 0;
    }
    left++;
    right++;
  }

  return *left == '\0' && *right == '\0';
}

static int metidos_sqlite_security_authorizer(
    void *user_data,
    int action_code,
    const char *argument1,
    const char *argument2,
    const char *database_name,
    const char *trigger_or_view_name) {
  (void)user_data;
  (void)argument1;
  (void)database_name;
  (void)trigger_or_view_name;

  switch (action_code) {
    case SQLITE_ATTACH:
    case SQLITE_DETACH:
      return SQLITE_DENY;
    case SQLITE_FUNCTION:
      if (metidos_ascii_equals_ignore_case(argument2, "load_extension")) {
        return SQLITE_DENY;
      }
      return SQLITE_OK;
    default:
      return SQLITE_OK;
  }
}

static int metidos_sqlite_security_install(sqlite3 *db) {
  return sqlite3_set_authorizer(db, metidos_sqlite_security_authorizer, 0);
}

#ifdef _WIN32
__declspec(dllexport)
#endif
int sqlite3_metidossqlitesecurity_init(
    sqlite3 *db,
    char **error_message,
    const sqlite3_api_routines *api) {
  (void)error_message;
  SQLITE_EXTENSION_INIT2(api);
  return metidos_sqlite_security_install(db);
}

#ifdef _WIN32
__declspec(dllexport)
#endif
int sqlite3_extension_init(
    sqlite3 *db,
    char **error_message,
    const sqlite3_api_routines *api) {
  return sqlite3_metidossqlitesecurity_init(db, error_message, api);
}
