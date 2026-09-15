/**
 * Role permissions must be enforced at the data layer, not just hidden in the
 * UI (spec 46 + 61). These tests call the real helpers directly.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { _clearMemoryStore } from '../js/store.js';
import {
  db, can, assertCan, teacherCanAccessClass, PERMISSIONS, DEFAULT_PERMISSIONS,
  teacherProfile, teacherStudents, teacherMaterials, teacherExams,
  checkSubmission, submitAssignment, getDbStatus, _setRemoteTransport
} from '../js/data.js';

const TEACHER = { role: 'teacher', name: 'রাহেলা আক্তার' };
const ADMIN = { role: 'admin', name: 'অ্যাডমিন' };
const STUDENT = { role: 'student', name: 'আরিয়ান' };

test('admin holds every permission', () => {
  for (const p of PERMISSIONS) assert.equal(can('admin', p), true, `admin: ${p}`);
});

test('teacher follows the configured matrix', () => {
  assert.equal(can('teacher', 'viewStudents'), true, 'default: may view students');
  assert.equal(can('teacher', 'manageExams'), true, 'default: may manage exams');
  assert.equal(can('teacher', 'managePayments'), false, 'never touches payments by default');
  assert.equal(can('teacher', 'deleteStudents'), false, 'never deletes students by default');
  assert.equal(can('teacher', 'manageUsers'), false, 'never manages users');
});

test('students hold no management permission at all', () => {
  for (const p of PERMISSIONS) assert.equal(can('student', p), false, `student: ${p}`);
});

test('narrowing the matrix in Settings takes effect immediately', () => {
  db.settings.update({ permissions: { teacher: ['viewStudents'] } });
  assert.equal(can('teacher', 'viewStudents'), true);
  assert.equal(can('teacher', 'manageExams'), false, 'revoked by admin');
  db.settings.update({ permissions: { ...DEFAULT_PERMISSIONS } });
  assert.equal(can('teacher', 'manageExams'), true, 'restored');
});

test('unknown roles and permissions are denied', () => {
  assert.equal(can('ghost', 'viewStudents'), false);
  assert.equal(can('teacher', 'notARealPermission'), false);
  assert.equal(can(null, 'viewStudents'), false);
});

test('assertCan throws a clear, non-technical error when denied', () => {
  db.settings.update({ permissions: { teacher: ['viewStudents'] } });
  assert.throws(() => assertCan(TEACHER, 'publishResults', 'ফলাফল প্রকাশ'), (err) => {
    assert.equal(err.code, 'FORBIDDEN');
    assert.match(err.message, /অনুমতি নেই/);
    assert.equal(/Error|undefined|stack/i.test(err.message), false, 'no internals leaked to the user');
    return true;
  });
  assert.equal(assertCan(ADMIN, 'publishResults'), true, 'admin passes');
  db.settings.update({ permissions: { ...DEFAULT_PERMISSIONS } });
});

test('a teacher only reaches the classes assigned to them', () => {
  const mine = teacherProfile(TEACHER.name).classNames;
  assert.ok(mine.includes('নবম'), 'assigned class');
  assert.equal(teacherCanAccessClass(TEACHER, 'নবম'), true);
  assert.equal(teacherCanAccessClass(TEACHER, 'দশম'), false, 'unassigned class denied');
  assert.equal(teacherCanAccessClass(STUDENT, 'নবম'), false, 'students manage nothing');
  assert.equal(teacherCanAccessClass(ADMIN, 'দশম'), true, 'admin reaches everything');
});

test('teacher data helpers never return rows from other classes', () => {
  const rows = [...teacherStudents(TEACHER.name), ...teacherMaterials(TEACHER.name), ...teacherExams(TEACHER.name)];
  for (const row of rows) {
    const cls = row.className;
    if (cls) assert.equal(cls, 'নবম', `${row.title || row.id || row.name} is from another class`);
  }
});

test('checking a submission records marks and feedback', () => {
  _clearMemoryStore();
  const student = db.students.find('2026-09-001');
  const asg = db.assignments.find('asg-1');
  submitAssignment(asg, student, 'কাজ শেষ');
  const sub = db.submissions.list().find((s) => s.studentId === student.id && s.assignmentId === asg.id);
  assert.ok(sub, 'submission exists');
  const checked = checkSubmission(sub.id, 'ভালো হয়েছে', 8);
  assert.equal(checked.status, 'চেক হয়েছে');
  assert.equal(checked.marks, 8, 'marks recorded');
  assert.equal(checked.feedback, 'ভালো হয়েছে');
  // a non-numeric marks value must not overwrite anything
  const again = checkSubmission(sub.id, 'আবার দেখা হলো', 'abc');
  assert.equal(again.marks, 8, 'garbage marks ignored');
});

test('database status never exposes credentials', () => {
  const status = getDbStatus();
  assert.ok('connected' in status && 'mode' in status && 'lastSync' in status && 'pending' in status);
  assert.deepEqual(Object.keys(status).sort(),
    ['configured', 'connected', 'error', 'lastSync', 'mode', 'online', 'pending'].sort());
  assert.equal(/AIza|apiKey|databaseURL|authDomain/.test(JSON.stringify(status)), false);
});

test('database status reports a failed sync honestly', () => {
  _clearMemoryStore();
  _setRemoteTransport(() => { throw new Error('offline'); });
  db.settings.update({ orgName: 'Active Plus' });
  const status = getDbStatus();
  assert.equal(status.error, 'sync-failed', 'failure surfaced, not swallowed');
  assert.equal(status.connected, false);
  _setRemoteTransport(null);
});


