import gzip
import pathlib
import sys
import tarfile

source, destination = map(pathlib.Path, sys.argv[1:])
with destination.open('wb') as output:
    with gzip.GzipFile(filename='', mode='wb', fileobj=output, mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode='w', format=tarfile.PAX_FORMAT) as archive:
            for entry in sorted(source.rglob('*')):
                info = archive.gettarinfo(entry, arcname=entry.relative_to(source))
                info.uid = info.gid = info.mtime = 0
                info.uname = info.gname = ''
                info.mode = 0o755 if entry.is_dir() or entry.stat().st_mode & 0o111 else 0o644
                info.pax_headers = {}
                if entry.is_file():
                    with entry.open('rb') as contents:
                        archive.addfile(info, contents)
                else:
                    archive.addfile(info)
