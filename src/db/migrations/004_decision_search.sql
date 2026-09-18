CREATE VIRTUAL TABLE decisions_fts USING fts5(subject, decision, reasoning, content='decisions', content_rowid='rowid');
INSERT INTO decisions_fts(decisions_fts) VALUES ('rebuild');
CREATE TRIGGER decisions_fts_insert AFTER INSERT ON decisions BEGIN
  INSERT INTO decisions_fts(rowid, subject, decision, reasoning)
  VALUES (new.rowid, new.subject, new.decision, new.reasoning);
END;
