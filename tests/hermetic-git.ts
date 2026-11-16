// Imported for its side effect, before anything else in a test file: git variables inherited from the
// process that started the suite (a Mission Control session's GIT_CEILING_DIRECTORIES, the GIT_DIR a
// git hook sets) must not change which repository a test's git commands see or what the office
// reports about it.
for (const name of ['GIT_CEILING_DIRECTORIES', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_NAMESPACE', 'GIT_PREFIX']) {
  delete process.env[name];
}
