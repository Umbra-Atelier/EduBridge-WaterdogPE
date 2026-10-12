package edu.bridge.service;

import edu.bridge.config.EduBridgeConfig;
import org.slf4j.Logger;

/**
 * Service alias for ClassroomJoinCodeService in edu.bridge.service.
 */
public class ClassroomJoinCodeService extends edu.bridge.joincode.ClassroomJoinCodeService {

    public ClassroomJoinCodeService() {
        super();
    }

    public ClassroomJoinCodeService(EduBridgeConfig config, Logger logger) {
        super(config, logger);
    }
}
