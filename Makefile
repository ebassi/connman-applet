UUID=connman-applet@connman.net
VERSION=0.0.2
TARGET_DIR=share/gnome-shell/extensions/${UUID}

SED=$(shell which sed)

metadata:
	@${SED} -e 's|@VERSION@|${VERSION}|' 	\
		-e 's|@UUID@|${UUID}|'		\
	< metadata.json.in \
	> metadata.json

all: metadata

clean:
	@rm -f metadata.json

install-local: all
	@mkdir --parents ${HOME}/.local/${TARGET_DIR}
	@cp extension.js metadata.json stylesheet.css ${HOME}/.local/${TARGET_DIR}

install: all
	@mkdir --parents ${DESTDIR}/usr/share/${TARGET_DIR}
	@cp extension.js metadata.json stylesheet.css ${DESTDIR}/usr/share/${TARGET_DIR}

tag:
	@git tag -s -m "ConnMan Extension ${VERSION} (release)" ${VERSION}

dist: all
	@git archive --format=tar --prefix=connman-applet-$(shell git describe)/ HEAD | \
	bzip2 > connman-applet-$(shell git describe).tar.bz2
