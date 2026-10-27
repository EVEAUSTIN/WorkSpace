import cloudbase from '@cloudbase/js-sdk/app';
import { registerAuth } from '@cloudbase/js-sdk/auth';
registerAuth(cloudbase);
cloudbase.registerVersion('3.10.4');
window.QijianCloudbase = cloudbase;
