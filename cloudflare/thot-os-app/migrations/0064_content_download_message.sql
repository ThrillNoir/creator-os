ALTER TABLE content_download_links ADD COLUMN custom_message TEXT
  CHECK(custom_message IS NULL OR (length(custom_message)<=500 AND instr(custom_message,char(0))=0));
