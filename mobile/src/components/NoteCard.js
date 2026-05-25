import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Platform, Modal } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';

export default function NoteCard({ note, color, onToggle, onUpdate, onDelete, onDateChange, onReminder }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note.content);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showReminderPicker, setShowReminderPicker] = useState(false);

  useEffect(() => {
    if (!editing) setText(note.content);
  }, [note.content]);

  function handleBlur() {
    setEditing(false);
    if (text !== note.content) onUpdate(text);
  }

  const isExpired = note.type === 'timeline' && note.customDate &&
    new Date(note.customDate + 'T23:59:59') < new Date() && !note.completed;

  const showReminder = note.type === 'daily' || note.type === 'weekly' || note.type === 'timeline';

  function handleReminderChange(event, selectedDate) {
    if (Platform.OS === 'android') setShowReminderPicker(false);
    if (selectedDate && onReminder) {
      onReminder(selectedDate.toISOString());
    }
  }

  function handleDateChange(event, selectedDate) {
    if (Platform.OS === 'android') setShowDatePicker(false);
    if (selectedDate && onDateChange) {
      onDateChange(selectedDate.toISOString().slice(0, 10));
    }
  }

  const dateDisplay = note.customDate || (note.type === 'timeline' ? '设置日期' : '');
  const hasReminder = !!note.remindAt;

  return (
    <View style={[styles.card, { backgroundColor: color }]}>
      <View style={styles.row}>
        <TouchableOpacity onPress={onToggle} style={styles.checkbox}>
          {note.completed && <Text style={{ fontSize: 14 }}>✓</Text>}
        </TouchableOpacity>
        {editing ? (
          <TextInput
            style={[styles.input, note.completed && styles.completed]}
            value={text}
            onChangeText={setText}
            onBlur={handleBlur}
            autoFocus multiline
          />
        ) : (
          <TouchableOpacity style={styles.content} onPress={() => setEditing(true)} onLongPress={onDelete}>
            <Text style={[styles.text, note.completed && styles.completedText, isExpired && styles.expiredText]}>
              {note.content || '点击编辑...'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 底部操作栏 */}
      <View style={styles.footer}>
        {note.type === 'timeline' && (
          <TouchableOpacity onPress={() => setShowDatePicker(true)} style={styles.footerBtn}>
            <Text style={styles.footerIcon}>📅</Text>
            <Text style={styles.footerLabel}>{dateDisplay}</Text>
          </TouchableOpacity>
        )}
        {showReminder && (
          <TouchableOpacity onPress={() => setShowReminderPicker(true)} style={styles.footerBtn}>
            <Text style={[styles.footerIcon, hasReminder && styles.reminderActive]}>🔔</Text>
            <Text style={styles.footerLabel}>{hasReminder ? '已设提醒' : '提醒'}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 日期选择器 */}
      {showDatePicker && (
        <DateTimePicker
          value={note.customDate ? new Date(note.customDate + 'T00:00:00') : new Date()}
          mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={handleDateChange}
        />
      )}

      {/* 提醒时间选择器 */}
      {showReminderPicker && (
        <DateTimePicker
          value={note.remindAt ? new Date(note.remindAt) : new Date()}
          mode="datetime" display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={handleReminderChange}
          minimumDate={new Date()}
        />
      )}
      {Platform.OS === 'ios' && showReminderPicker && (
        <TouchableOpacity onPress={() => setShowReminderPicker(false)} style={styles.iosDoneBtn}>
          <Text style={styles.iosDoneText}>完成</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 10, padding: 12, marginBottom: 8,
    elevation: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1, shadowRadius: 2,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  checkbox: {
    width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: 'rgba(0,0,0,0.18)',
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  content: { flex: 1 },
  text: { fontSize: 15, lineHeight: 22, color: '#333' },
  input: { flex: 1, fontSize: 15, lineHeight: 22, color: '#333', padding: 0 },
  completedText: { textDecorationLine: 'line-through', color: '#999' },
  expiredText: { color: '#999' },
  footer: { flexDirection: 'row', alignItems: 'center', marginTop: 6, marginLeft: 28, gap: 12 },
  footerBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(255,255,255,0.6)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  footerIcon: { fontSize: 13 },
  footerLabel: { fontSize: 12, color: '#555' },
  reminderActive: { opacity: 1 },
  iosDoneBtn: { marginLeft: 28, marginTop: 6, paddingHorizontal: 12, paddingVertical: 4, backgroundColor: '#1a73e8', borderRadius: 6, alignSelf: 'flex-start' },
  iosDoneText: { color: '#fff', fontSize: 13 },
});
