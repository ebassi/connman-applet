UUID=connman-applet@connman.net
TARGET_DIR=share/gnome-shell/extensions/${UUID}

all:
	@echo Nothing to do, try "make install-local" or "make install".

install-local:
	@mkdir --parents ${HOME}/.local/${TARGET_DIR}
	@cp extension.js metadata.json stylesheet.css ${HOME}/.local/${TARGET_DIR}

install:
	@mkdir --parents ${DESTDIR}/usr/share/${TARGET_DIR}
	@cp extension.js metadata.json stylesheet.css ${DESTDIR}/usr/share/${TARGET_DIR}

dist:
	git archive --format=tar --prefix=connman-applet-$(shell git describe)/ HEAD | \
	bzip2 > connman-applet-$(shell git describe).tar.bz2
