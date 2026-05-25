import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet, Alert,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import notesStore from '../store/notesStore';
import NoteCard from '../components/NoteCard';

const TABS = [
  { key: 'daily', label: '今日', color: '#FFCDD2' },
  { key: 'weekly', label: '周', color: '#FFE0B2' },
  { key: 'normal', label: '便签', color: '#C8E6C9' },
  { key: 'timeline', label: '时间轴', color: '#F8BBD0' },
];

const TYPE_COLORS = {
  daily: '#FFCDD2',
  weekly: '#FFE0B2',
  normal: '#C8E6C9',
  timeline: '#F8BBD0',
};

export default function HomeScreen() {
  const [notes, setNotes] = useState([]);
  const [activeTab, setActiveTab] = useState('daily');
  const [searchText, setSearchText] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showAddDatePicker, setShowAddDatePicker] = useState(false);
  const [pendingAddType, setPendingAddType] = useState(null);

  useEffect(() => {
    const unsub = notesStore.onChange((n) => setNotes([...n]));
    return unsub;
  }, []);

  function getEffectiveType(note) {
    if (note.type !== 'timeline' || !note.customDate) return note.type;
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    if (note.customDate === todayStr) return 'daily';
    const custom = new Date(note.customDate + 'T00:00:00');
    const dow = today.getDay();
    const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (dow === 0 ? 6 : dow - 1));
    const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    if (custom >= monday && custom <= sunday) return 'weekly';
    return 'timeline';
  }

  const filteredNotes = notes
    .filter(n => {
      if (activeTab === 'timeline') return n.type === 'timeline';
      return getEffectiveType(n) === activeTab;
    })
    .filter(n => {
      if (!searchText) return true;
      return n.content.toLowerCase().includes(searchText.toLowerCase());
    })
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  const handleAdd = useCallback(() => {
    if (activeTab === 'timeline') {
      // 时间轴：先弹出日期选择
      setPendingAddType('timeline');
      setShowAddDatePicker(true);
    } else {
      notesStore.addNote(activeTab);
    }
  }, [activeTab]);

  function handleAddDateChange(event, selectedDate) {
    setShowAddDatePicker(false);
    setPendingAddType(null);
    if (selectedDate) {
      notesStore.addNote('timeline', selectedDate.toISOString().slice(0, 10));
    }
  }

  const handleToggle = useCallback((id) => {
    const note = notes.find(n => n.id === id);
    if (note) notesStore.updateNote(id, { completed: !note.completed });
  }, [notes]);

  const handleUpdate = useCallback((id, content) => {
    notesStore.updateNote(id, { content });
  }, []);

  const handleDelete = useCallback((id) => {
    Alert.alert('删除便签', '确定删除这条便签吗？', [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => notesStore.deleteNote(id) },
    ]);
  }, []);

  const handleDateChange = useCallback((id, customDate) => {
    notesStore.updateNote(id, { customDate });
  }, []);

  const handleReminder = useCallback((id, remindAt) => {
    notesStore.setReminder(id, remindAt);
  }, []);

  return (
    <View style={styles.container}>
      {/* 标题栏 */}
      <View style={styles.header}>
        <Text style={styles.title}>片笺</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => setShowSearch(!showSearch)} style={styles.iconBtn}>
            <Text style={{ fontSize: 18 }}>🔍</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleAdd} style={styles.iconBtn}>
            <Text style={{ fontSize: 22 }}>＋</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 搜索栏 */}
      {showSearch && (
        <View style={styles.searchBar}>
          <TextInput
            style={styles.searchInput}
            placeholder="搜索便签..."
            value={searchText}
            onChangeText={setSearchText}
            autoFocus
          />
        </View>
      )}

      {/* 分类标签 */}
      <View style={styles.tabs}>
        {TABS.map(tab => (
          <TouchableOpacity
            key={tab.key}
            onPress={() => setActiveTab(tab.key)}
            style={[
              styles.tab,
              { backgroundColor: activeTab === tab.key ? tab.color : '#f0f0f0' },
            ]}
          >
            <Text style={[
              styles.tabText,
              { color: activeTab === tab.key ? '#333' : '#999' },
            ]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 便签列表 */}
      <FlatList
        data={filteredNotes}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <NoteCard
            note={item}
            color={TYPE_COLORS[item.type]}
            onToggle={() => handleToggle(item.id)}
            onUpdate={(content) => handleUpdate(item.id, content)}
            onDelete={() => handleDelete(item.id)}
            onDateChange={(date) => handleDateChange(item.id, date)}
            onReminder={(remindAt) => handleReminder(item.id, remindAt)}
          />
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>暂无便签，点击 ＋ 添加</Text>
        }
      />

      {/* 新建时间轴便签的日期选择器 */}
      {showAddDatePicker && (
        <View style={styles.addDateOverlay}>
          <View style={styles.addDateContainer}>
            <Text style={styles.addDateTitle}>选择日期</Text>
            <DateTimePicker
              value={new Date()}
              mode="date"
              display="spinner"
              onChange={handleAddDateChange}
            />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 48, paddingBottom: 8, backgroundColor: '#fff',
  },
  title: { fontSize: 22, fontWeight: 'bold', color: '#333' },
  headerActions: { flexDirection: 'row', gap: 12 },
  iconBtn: { padding: 6 },
  searchBar: { paddingHorizontal: 16, paddingBottom: 8, backgroundColor: '#fff' },
  searchInput: {
    backgroundColor: '#f0f0f0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15,
  },
  tabs: {
    flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8, gap: 8, backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#eee',
  },
  tab: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 16 },
  tabText: { fontSize: 14, fontWeight: '500' },
  list: { padding: 12, paddingBottom: 100 },
  empty: { textAlign: 'center', color: '#999', marginTop: 60, fontSize: 15 },
  addDateOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center',
  },
  addDateContainer: {
    backgroundColor: '#fff', borderRadius: 14, padding: 20, width: '85%',
    alignItems: 'center',
  },
  addDateTitle: { fontSize: 17, fontWeight: '600', color: '#333', marginBottom: 12 },
});
